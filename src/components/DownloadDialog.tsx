'use client';

import { useEffect, useRef, useState } from 'react';
import { documentDisplayTitle, formatDocumentPageCount, formatDocumentSize } from '@/lib/cmsBlocks';
import {
  getDownloadFormEmail,
  getDownloadFormSubmissionId,
  isDownloadFormUnlocked,
  unlockDownloadForm,
} from '@/lib/downloadFormUnlock';
import type { CMSDocument, CMSFormConfig, CMSFormField } from '@/lib/api-types';
import {
  checkPickedFile,
  fileAcceptAttribute,
  fileMaxSizeMB,
  fileTypesSummary,
  formatFileSize,
  isDisplayOnlyField,
  readFileAsBase64,
  totalFileBytes,
  type FormFileValue,
} from '@/lib/formFields';

type DownloadDialogProps = {
  doc: CMSDocument | null;
  open: boolean;
  onClose: () => void;
  /** Optional gate form — when set and not unlocked, must be completed first. */
  gateForm?: CMSFormConfig | null;
  captchaSiteKey?: string;
  captchaDisabled?: boolean;
  captchaProvider?: string;
};

const TENANT_SLUG = process.env.NEXT_PUBLIC_TENANT_SLUG || 'deaisummit';
const FALLBACK_RECAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || '';

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      render?: (el: HTMLElement, opts: { sitekey: string; theme?: string }) => number;
      getResponse?: (id?: number) => string;
      reset?: (id?: number) => void;
      execute?: (siteKey: string, opts: { action: string }) => Promise<string>;
    };
  }
}

function sanitizeFilename(name: string): string {
  const trimmed = name.trim() || 'download';
  return trimmed.replace(/[^\w.\-()+ ]+/g, '_');
}

function filesHref(doc: CMSDocument, opts?: { download?: boolean }): string | null {
  const suffix = opts?.download ? '?download=1' : '';
  const fromPath = (() => {
    const raw = doc.path?.replace(/^\/+/, '');
    if (!raw) return null;
    const parts = raw.split('/').filter(Boolean);
    if (!parts.length) return null;
    if (parts[0] === TENANT_SLUG) parts.shift();
    if (!parts.length) return null;
    return `/files/${parts.map(encodeURIComponent).join('/')}${suffix}`;
  })();
  if (fromPath) return fromPath;

  try {
    const u = new URL(doc.url);
    const marker = '/storage/v1/object/public/tenants/';
    const idx = u.pathname.indexOf(marker);
    if (idx < 0) return null;
    const after = decodeURIComponent(u.pathname.slice(idx + marker.length));
    const parts = after.split('/').filter(Boolean);
    if (parts[0] === TENANT_SLUG) parts.shift();
    if (!parts.length) return null;
    return `/files/${parts.map(encodeURIComponent).join('/')}${suffix}`;
  } catch {
    return null;
  }
}

function filesDownloadHref(doc: CMSDocument): string | null {
  return filesHref(doc, { download: true });
}

function gatedDocumentPath(doc: CMSDocument): string | null {
  const raw = doc.path?.replace(/^\/+/, '').trim();
  if (raw) {
    return raw.startsWith(`${TENANT_SLUG}/`) ? raw : `${TENANT_SLUG}/${raw}`;
  }
  try {
    const u = new URL(doc.url);
    const marker = '/storage/v1/object/public/tenants/';
    const idx = u.pathname.indexOf(marker);
    if (idx < 0) return null;
    const after = decodeURIComponent(u.pathname.slice(idx + marker.length));
    return after.replace(/^\/+/, '') || null;
  } catch {
    return null;
  }
}

function extractEmailFromValues(
  values: Record<string, string>,
  fields: CMSFormField[],
): string | null {
  const emailField = fields.find((f) => f.type === 'email');
  if (emailField && values[emailField.name]?.trim()) {
    return values[emailField.name].trim().toLowerCase();
  }
  for (const field of fields) {
    const v = values[field.name]?.trim();
    if (v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return v.toLowerCase();
    if (/email/i.test(field.name) || /email/i.test(field.label)) {
      if (v) return v.toLowerCase();
    }
  }
  return null;
}

function triggerBrowserDownload(href: string, filename: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function ensureRecaptchaScript(src: string) {
  if (typeof document === 'undefined') return;
  if (document.querySelector(`script[src="${src}"]`)) return;
  const el = document.createElement('script');
  el.src = src;
  el.async = true;
  document.body.appendChild(el);
}

function sortedFields(form: CMSFormConfig): CMSFormField[] {
  return [...(form.form_fields || [])].sort(
    (a, b) => ((a as { order?: number }).order ?? 0) - ((b as { order?: number }).order ?? 0),
  );
}

function fieldWidthClass(field: CMSFormField): string {
  const width = (field as { width?: string }).width;
  return width === 'half' ? 'sm:col-span-1' : 'sm:col-span-2';
}

export function DownloadDialog({
  doc,
  open,
  onClose,
  gateForm,
  captchaSiteKey,
  captchaDisabled,
  captchaProvider,
}: DownloadDialogProps) {
  const [isClosing, setIsClosing] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [savedEmail, setSavedEmail] = useState<string | null>(null);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState('');
  const [editingEmail, setEditingEmail] = useState(false);
  /** Hide email CTA right after form submit — that flow already mailed this document. */
  const [suppressEmailAction, setSuppressEmailAction] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  /** `file` field values (base64 inside the JSON submit body); null = nothing chosen. */
  const [fileValues, setFileValues] = useState<Record<string, FormFileValue | null>>({});
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});

  const formKey = gateForm?.id || gateForm?.form_slug || '';
  const formCaptchaEnabled = gateForm?.form_settings?.captcha?.enabled === true;
  const siteKey =
    captchaDisabled || !formCaptchaEnabled
      ? ''
      : captchaSiteKey || FALLBACK_RECAPTCHA_SITE_KEY;
  const isV3 = (captchaProvider || 'recaptcha') === 'recaptcha-v3';
  const recaptchaRef = useRef<HTMLDivElement>(null);
  const captchaWidgetId = useRef<number | null>(null);

  const label = doc ? documentDisplayTitle(doc) : '';
  const sizeLabel = doc ? formatDocumentSize(doc.size) : null;
  const pagesLabel = doc ? formatDocumentPageCount(doc.pageCount) : null;
  const isPdf =
    !!doc &&
    (doc.mimeType?.includes('pdf') || doc.name?.toLowerCase().endsWith('.pdf'));

  const needsGate = !!gateForm && !!formKey;
  const showActions = !needsGate || unlocked;
  const fields = gateForm ? sortedFields(gateForm) : [];

  useEffect(() => {
    if (open) {
      setIsVisible(true);
      document.body.style.overflow = 'hidden';
      setDownloading(false);
      setEmailing(false);
      setSubmitting(false);
      setErrorMessage('');
      setSuccessMessage('');
      setValues({});
      setFileValues({});
      setFileErrors({});
      captchaWidgetId.current = null;
      const already = needsGate ? isDownloadFormUnlocked(formKey) : true;
      setUnlocked(already);
      const stored = needsGate ? getDownloadFormEmail(formKey) : null;
      const storedSubmission = needsGate ? getDownloadFormSubmissionId(formKey) : null;
      setSavedEmail(stored);
      setSubmissionId(storedSubmission);
      setEmailDraft(stored || '');
      setEditingEmail(false);
      setSuppressEmailAction(false);
    } else {
      const timer = setTimeout(() => setIsVisible(false), 300);
      document.body.style.overflow = 'unset';
      return () => clearTimeout(timer);
    }
  }, [open, needsGate, formKey, doc?.url]);

  useEffect(() => {
    if (!open || !siteKey || showActions) return;
    ensureRecaptchaScript(
      isV3
        ? `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`
        : 'https://www.google.com/recaptcha/api.js?render=explicit',
    );
  }, [open, siteKey, isV3, showActions]);

  useEffect(() => {
    if (!open || !siteKey || isV3 || showActions) return;
    if (captchaWidgetId.current !== null) return;

    const tryRender = () => {
      if (!recaptchaRef.current || !window.grecaptcha?.render) return;
      if (captchaWidgetId.current !== null) return;
      try {
        recaptchaRef.current.innerHTML = '';
        captchaWidgetId.current = window.grecaptcha.render(recaptchaRef.current, {
          sitekey: siteKey,
          theme: 'light',
        });
      } catch (err) {
        console.error('reCAPTCHA render error:', err);
      }
    };

    if (window.grecaptcha?.render) {
      tryRender();
      return;
    }

    const id = window.setInterval(() => {
      if (window.grecaptcha?.render) {
        window.clearInterval(id);
        tryRender();
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [open, siteKey, isV3, showActions, doc?.url]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      captchaWidgetId.current = null;
      onClose();
    }, 300);
  };

  const handleView = () => {
    if (!doc) return;
    const href = filesHref(doc) || doc.url;
    if (!href) return;
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  const handleDownload = async () => {
    if (!doc?.url || downloading) return;

    const filename = sanitizeFilename(
      doc.name || (isPdf ? `${label}.pdf` : label) || 'download',
    );

    setDownloading(true);
    setErrorMessage('');
    setSuccessMessage('');

    const downloadBlob = async (href: string) => {
      const res = await fetch(href);
      if (!res.ok) throw new Error(`Download failed (${res.status}).`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      try {
        triggerBrowserDownload(objectUrl, filename);
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      }
    };

    try {
      const proxyHref = filesDownloadHref(doc);
      if (proxyHref) {
        try {
          await downloadBlob(proxyHref);
          return;
        } catch {
          /* try direct URL */
        }
      }
      await downloadBlob(doc.url);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Download failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const emailDocumentViaApi = async (opts: {
    submissionId: string;
    email?: string;
  }) => {
    if (!doc || !gateForm) throw new Error('No document selected.');
    const documentPath = gatedDocumentPath(doc);
    if (!documentPath) throw new Error('This document cannot be emailed.');

    const idOrSlug = gateForm.form_slug || gateForm.id;
    const res = await fetch(`/api/forms/${encodeURIComponent(idOrSlug)}/email-document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submission_id: opts.submissionId,
        document_path: documentPath,
        ...(opts.email ? { email: opts.email } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Could not send the email. Please try again.');
    }
    return (data.message as string) || 'Email sent.';
  };

  const handleEmailSelf = async () => {
    if (!doc || emailing) return;
    const sid = submissionId || (needsGate ? getDownloadFormSubmissionId(formKey) : null);
    if (!sid) {
      setErrorMessage('Please complete the unlock form again before emailing.');
      return;
    }
    const to = (
      (editingEmail || !savedEmail ? emailDraft.trim().toLowerCase() : null) ||
      savedEmail ||
      (needsGate ? getDownloadFormEmail(formKey) : null) ||
      emailDraft.trim().toLowerCase()
    );
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setErrorMessage('Enter a valid email address to send this document.');
      return;
    }

    setEmailing(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const message = await emailDocumentViaApi({ submissionId: sid, email: to });
      if (needsGate && formKey) persistUnlock(to, sid);
      setEditingEmail(false);
      setSuccessMessage(message);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not send the email.');
    } finally {
      setEmailing(false);
    }
  };

  const startEditEmail = () => {
    setEmailDraft(savedEmail || '');
    setEditingEmail(true);
    setErrorMessage('');
    setSuccessMessage('');
  };

  const cancelEditEmail = () => {
    setEmailDraft(savedEmail || '');
    setEditingEmail(false);
    setErrorMessage('');
  };

  const saveEditedEmail = () => {
    const next = emailDraft.trim().toLowerCase();
    if (!next || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
      setErrorMessage('Enter a valid email address.');
      return;
    }
    const sid = submissionId || getDownloadFormSubmissionId(formKey);
    if (!sid) {
      setErrorMessage('Please complete the unlock form again.');
      return;
    }
    if (needsGate && formKey) persistUnlock(next, sid);
    setEditingEmail(false);
    setErrorMessage('');
    setSuccessMessage('');
  };

  const resolveCaptchaToken = async (): Promise<string | undefined> => {
    if (!siteKey) return undefined;
    if (isV3) {
      return new Promise<string>((resolve, reject) => {
        if (!window.grecaptcha?.ready || !window.grecaptcha.execute) {
          reject(new Error('reCAPTCHA not ready'));
          return;
        }
        window.grecaptcha.ready(() => {
          window.grecaptcha!
            .execute!(siteKey, { action: 'download_form' })
            .then(resolve)
            .catch(reject);
        });
      });
    }
    const token = window.grecaptcha?.getResponse?.(captchaWidgetId.current ?? undefined);
    if (!token) throw new Error('Please complete the captcha verification.');
    return token;
  };

  const persistUnlock = (email: string, sid: string) => {
    unlockDownloadForm(formKey, email, sid);
    if (gateForm?.form_slug) unlockDownloadForm(gateForm.form_slug, email, sid);
    if (gateForm?.id) unlockDownloadForm(gateForm.id, email, sid);
    setSavedEmail(email);
    setSubmissionId(sid);
    setUnlocked(true);
  };

  const handleFileChange = async (field: CMSFormField, input: HTMLInputElement) => {
    const file = input.files?.[0];
    setFileErrors((prev) => ({ ...prev, [field.name]: '' }));
    if (!file) return;

    const reject = (message: string) => {
      setFileErrors((prev) => ({ ...prev, [field.name]: message }));
      setFileValues((prev) => ({ ...prev, [field.name]: null }));
      input.value = '';
    };

    const check = checkPickedFile({
      field,
      file,
      otherFilesBytes: totalFileBytes(fileValues, field.name),
    });
    if (!check.ok) {
      reject(
        check.reason === 'type'
          ? "This file type isn't allowed."
          : check.reason === 'size'
            ? `This file is too large (max ${fileMaxSizeMB(field)} MB).`
            : 'The files you attached are over the 3 MB total limit.',
      );
      return;
    }

    try {
      const data = await readFileAsBase64(file);
      setFileValues((prev) => ({
        ...prev,
        [field.name]: { name: file.name, type: file.type, size: file.size, data },
      }));
    } catch {
      reject("We couldn't read that file. Please try another one.");
    }
  };

  const removeFile = (field: CMSFormField) => {
    setFileErrors((prev) => ({ ...prev, [field.name]: '' }));
    setFileValues((prev) => ({ ...prev, [field.name]: null }));
    const input = document.getElementById(`dl-field-${field.name}`);
    if (input instanceof HTMLInputElement) input.value = '';
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gateForm || submitting) return;

    for (const field of fields) {
      if (isDisplayOnlyField(field) || !field.required) continue;
      const missing =
        field.type === 'file'
          ? !fileValues[field.name]
          : !String(values[field.name] || '').trim();
      if (missing) {
        setErrorMessage(
          field.type === 'file' ? `Please attach a file for ${field.label}.` : `Please fill in ${field.label}.`,
        );
        return;
      }
    }

    const email = extractEmailFromValues(
      values,
      fields.filter((f) => !isDisplayOnlyField(f) && f.type !== 'file'),
    );
    if (!email) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    setSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      let captchaToken: string | undefined;
      if (siteKey) {
        captchaToken = await resolveCaptchaToken();
      }

      const idOrSlug = gateForm.form_slug || gateForm.id;
      const documentPath = doc ? gatedDocumentPath(doc) : null;
      const res = await fetch(`/api/forms/${encodeURIComponent(idOrSlug)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Display-only fields never hold a value; a file key is omitted when nothing was chosen.
          submission_data: {
            ...values,
            ...Object.fromEntries(Object.entries(fileValues).filter(([, v]) => v !== null)),
          },
          captchaToken,
          ...(documentPath ? { download_request: { document_path: documentPath } } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMessage(data.error || 'Could not submit the form. Please try again.');
        if (!isV3) {
          try {
            window.grecaptcha?.reset?.(captchaWidgetId.current ?? undefined);
          } catch {
            /* ignore */
          }
        }
        return;
      }

      const sid =
        (typeof data.data?.id === 'string' && data.data.id) ||
        (typeof data.id === 'string' && data.id) ||
        '';
      if (!sid) {
        setErrorMessage('Form saved, but unlock token was missing. Please try again.');
        return;
      }

      persistUnlock(email, sid);

      try {
        const message = await emailDocumentViaApi({ submissionId: sid, email });
        setSuppressEmailAction(true);
        setSuccessMessage(message);
      } catch (mailErr) {
        setSuppressEmailAction(false);
        setErrorMessage(
          mailErr instanceof Error
            ? mailErr.message
            : 'Form saved, but we could not email the document. Use “Email it to yourself” to retry.',
        );
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not submit the form.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isVisible && !open) return null;
  if (!doc) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center p-4 transition-opacity duration-300 ${
        open && !isClosing ? 'opacity-100' : 'opacity-0'
      }`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="download-dialog-title"
    >
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={handleClose} />

      <div
        className={`relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden transform transition-all duration-300 ${
          open && !isClosing ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'
        }`}
      >
        <div className="relative px-8 pt-8 pb-6 bg-[#F0F0EF] border-b border-slate-100">
          <button
            type="button"
            onClick={handleClose}
            className="absolute top-6 right-6 p-2 text-slate-400 hover:text-slate-600 transition-colors rounded-full hover:bg-slate-100"
            aria-label="Close"
          >
            <i className="ri-close-line text-2xl" />
          </button>
          <p className="text-xs font-mono uppercase tracking-widest text-brand-cyan mb-2">
            {showActions ? 'Download' : gateForm?.form_name || 'Unlock download'}
          </p>
          <h2 id="download-dialog-title" className="text-2xl font-display font-bold text-slate-900 mb-2 pr-10">
            {label}
          </h2>
          <p className="text-sm text-slate-500">
            {showActions
              ? [isPdf ? 'PDF document' : 'Document', pagesLabel, sizeLabel].filter(Boolean).join(' · ')
              : gateForm?.form_description?.trim() ||
                'Complete this short form once to unlock view, download, and email for all documents.'}
          </p>
        </div>

        <div className="p-8 space-y-3">
          {showActions ? (
            <>
              <button
                type="button"
                onClick={handleView}
                className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-[#050A1F] text-white text-sm font-bold hover:bg-brand-cyan transition-colors"
              >
                <i className="ri-eye-line text-lg" />
                View document
              </button>
              <button
                type="button"
                onClick={handleDownload}
                disabled={downloading}
                className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full border border-[#050A1F] text-[#050A1F] text-sm font-bold hover:bg-[#050A1F] hover:text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {downloading ? (
                  <>
                    <i className="ri-loader-4-line animate-spin text-lg" />
                    Preparing download…
                  </>
                ) : (
                  <>
                    <i className="ri-download-2-line text-lg" />
                    Download document
                  </>
                )}
              </button>
              {needsGate && !suppressEmailAction ? (
                <>
                  {!savedEmail || editingEmail ? (
                    <div className="space-y-1.5">
                      <label
                        htmlFor="dl-email-self"
                        className="text-xs font-semibold uppercase tracking-wider text-slate-500"
                      >
                        Email address
                      </label>
                      <input
                        id="dl-email-self"
                        type="email"
                        autoComplete="email"
                        value={emailDraft}
                        onChange={(e) => setEmailDraft(e.target.value)}
                        placeholder="you@company.com"
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-cyan/20 focus:border-brand-cyan transition-all"
                      />
                      {editingEmail && savedEmail ? (
                        <div className="flex items-center justify-end gap-3 pt-1">
                          <button
                            type="button"
                            onClick={cancelEditEmail}
                            className="text-xs font-semibold text-slate-400 hover:text-slate-600 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={saveEditedEmail}
                            className="text-xs font-semibold text-brand-cyan hover:text-[#050A1F] transition-colors"
                          >
                            Save
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleEmailSelf}
                    disabled={emailing}
                    className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full border border-[#050A1F] text-[#050A1F] text-sm font-bold hover:bg-[#050A1F] hover:text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {emailing ? (
                      <>
                        <i className="ri-loader-4-line animate-spin text-lg" />
                        Sending email…
                      </>
                    ) : (
                      <>
                        <i className="ri-mail-send-line text-lg" />
                        Email it to yourself
                      </>
                    )}
                  </button>
                  {savedEmail && !editingEmail ? (
                    <p className="text-xs text-slate-400 text-center pt-1">
                      We’ll send to {savedEmail}{' '}
                      <button
                        type="button"
                        onClick={startEditEmail}
                        className="underline underline-offset-2 hover:text-slate-600 transition-colors"
                      >
                        Edit
                      </button>
                    </p>
                  ) : null}
                </>
              ) : null}
            </>
          ) : (
            <form className="space-y-4" onSubmit={handleFormSubmit}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {fields.map((field) => {
                  if (field.type === 'heading') {
                    return (
                      <h3
                        key={field.id || field.name}
                        className="sm:col-span-2 text-sm font-bold text-slate-900"
                      >
                        {field.label}
                      </h3>
                    );
                  }
                  if (field.type === 'paragraph') {
                    return (
                      <p
                        key={field.id || field.name}
                        className="sm:col-span-2 whitespace-pre-line text-sm text-slate-500"
                      >
                        {field.label}
                      </p>
                    );
                  }
                  if (field.type === 'file') {
                    const current = fileValues[field.name] ?? null;
                    const fileError = fileErrors[field.name];
                    return (
                      <div key={field.id || field.name} className={`space-y-1.5 ${fieldWidthClass(field)}`}>
                        <label
                          htmlFor={`dl-field-${field.name}`}
                          className="text-xs font-semibold uppercase tracking-wider text-slate-500"
                        >
                          {field.label}
                          {field.required ? <span className="text-brand-cyan"> *</span> : null}
                        </label>
                        {current ? (
                          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900">
                            <span className="min-w-0 truncate" title={current.name}>
                              {current.name}{' '}
                              <span className="text-xs text-slate-400">({formatFileSize(current.size)})</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => removeFile(field)}
                              className="shrink-0 text-xs font-semibold text-brand-cyan hover:text-[#050A1F] transition-colors"
                            >
                              Remove
                            </button>
                          </div>
                        ) : null}
                        <input
                          id={`dl-field-${field.name}`}
                          type="file"
                          hidden={current !== null}
                          accept={fileAcceptAttribute(field)}
                          aria-required={field.required ? true : undefined}
                          aria-invalid={fileError ? true : undefined}
                          onChange={(e) => void handleFileChange(field, e.target)}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-cyan/20 focus:border-brand-cyan transition-all"
                        />
                        <p className="text-xs text-slate-400">
                          {fileTypesSummary(field)} · max {fileMaxSizeMB(field)} MB
                        </p>
                        {field.helpText ? <p className="text-xs text-slate-400">{field.helpText}</p> : null}
                        {fileError ? (
                          <p className="text-xs text-red-600" role="alert">
                            {fileError}
                          </p>
                        ) : null}
                      </div>
                    );
                  }
                  const inputType =
                    field.type === 'email'
                      ? 'email'
                      : field.type === 'phone'
                        ? 'tel'
                        : field.type === 'datetime'
                          ? 'datetime-local'
                          : 'text';
                  const isTextarea = field.type === 'textarea' || field.type === 'richtext';
                  return (
                    <div key={field.id || field.name} className={`space-y-1.5 ${fieldWidthClass(field)}`}>
                      <label
                        htmlFor={`dl-field-${field.name}`}
                        className="text-xs font-semibold uppercase tracking-wider text-slate-500"
                      >
                        {field.label}
                        {field.required ? <span className="text-brand-cyan"> *</span> : null}
                      </label>
                      {isTextarea ? (
                        <textarea
                          id={`dl-field-${field.name}`}
                          required={!!field.required}
                          rows={3}
                          value={values[field.name] || ''}
                          placeholder={field.placeholder || ''}
                          onChange={(e) =>
                            setValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                          }
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-cyan/20 focus:border-brand-cyan transition-all resize-y"
                        />
                      ) : (
                        <input
                          id={`dl-field-${field.name}`}
                          type={inputType}
                          required={!!field.required}
                          autoComplete={
                            field.type === 'email'
                              ? 'email'
                              : /name/i.test(field.label)
                                ? 'name'
                                : /company/i.test(field.label)
                                  ? 'organization'
                                  : 'on'
                          }
                          value={values[field.name] || ''}
                          placeholder={field.placeholder || ''}
                          onChange={(e) =>
                            setValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                          }
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-cyan/20 focus:border-brand-cyan transition-all"
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              {siteKey && !isV3 ? <div ref={recaptchaRef} className="min-h-[78px]" /> : null}

              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-[#050A1F] text-white text-sm font-bold hover:bg-brand-cyan transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>
                    <i className="ri-loader-4-line animate-spin text-lg" />
                    Submitting…
                  </>
                ) : (
                  <>
                    <i className="ri-mail-send-line text-lg" />
                    Submit &amp; email document
                  </>
                )}
              </button>
            </form>
          )}

          {successMessage ? (
            <p className="text-sm text-emerald-700 text-center" role="status">
              {successMessage}
            </p>
          ) : null}
          {errorMessage ? (
            <p className="text-sm text-red-600 text-center" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
