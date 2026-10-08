// Types matching ep-api response shapes

export interface PersonCompany {
  company_id: string;
  company_name?: string;
  company_slug?: string;
  company_logo?: string;
  company_website?: string;
  is_founder?: boolean;
  person_job_title?: string;
  member_job_title?: string;
}

export interface PersonSocials {
  linkedin?: string;
  x?: string;
  twitter?: string;
  telegram?: string;
  github?: string;
  youtube?: string;
  discord?: string;
  facebook?: string;
  instagram?: string;
  mastodon?: string;
  medium?: string;
  meetup?: string;
  luma?: string;
  tiktok?: string;
}

export interface Member {
  id: string;
  person_firstname: string;
  person_surname: string;
  person_title?: string;
  person_slug: string;
  person_bio?: string;
  speaker_bio?: string;
  person_photo?: string;
  person_photo_nobg?: string;
  photo_settings?: import('./personPhoto').PersonPhotoSource['photo_settings'];
  person_website?: string;
  person_socials?: PersonSocials;
  person_companies?: PersonCompany[];
  is_speaker: boolean;
  is_speaker_featured: boolean;
  is_speaker_published: boolean;
  is_team_member: boolean;
  is_vip: boolean;
  is_published: boolean;
  tenant_id: string;
  seo?: SEOSettings;
}

export interface CompanySocials {
  linkedin?: string;
  x?: string;
  twitter?: string;
  telegram?: string;
  github?: string;
  youtube?: string;
  discord?: string;
  facebook?: string;
  instagram?: string;
  meetup?: string;
  luma?: string;
  tiktok?: string;
}

export interface Company {
  id: string;
  company_name: string;
  company_slug: string;
  company_bio?: string;
  company_logo?: string;
  company_thumbnail?: string;
  company_website?: string;
  company_email?: string;
  company_phone?: string;
  company_address?: string;
  company_city?: string;
  company_country?: string;
  company_google_maps?: string;
  company_socials?: CompanySocials;
  company_is_sponsor: boolean;
  company_is_venue: boolean;
  company_is_supporter: boolean;
  company_is_partner: boolean;
  company_is_organizer?: boolean;
  company_is_affiliated_hotel?: boolean;
  company_published: boolean;
  sponsor_published: boolean;
  venue_published: boolean;
  supporter_published: boolean;
  partner_published: boolean;
  organizer_published?: boolean;
  affiliated_hotel_published?: boolean;
  company_affiliated_hotel_bookings_url?: string | null;
  company_embedded_youtube?: string;
  company_youtube_videos?: unknown[];
  venue_photo?: string;
  logo_background_white?: boolean;
  company_logo_has_dark_bg?: boolean;
  logo_settings?: {
    vectorSvgUrl?: string;
    slots?: Partial<Record<'scroller' | 'general' | 'primary', {
      url?: string;
      snapshotId?: string;
      scale?: number;
      invert?: boolean;
    }>>;
  } | null;
  brochure_url?: string;
  tenant_id: string;
  seo?: SEOSettings;
}

export interface SEOSettings {
  id?: string;
  meta_title?: string;
  meta_description?: string;
  meta_keywords?: string;
  og_title?: string;
  og_description?: string;
  og_image?: string;
  og_type?: string;
  robots_tag?: string;
  canonical_url?: string;
  structured_data?: Record<string, unknown>;
}

export interface NormalizedSpeaker {
  id: string;
  name: string;
  title?: string;
  slug: string;
  role: string;
  company: string;
  /** Resolved photo URL — `photo_settings.activeEnhancedUrl` ?? `person_photo_nobg` ?? `person_photo`. */
  image: string;
  /** Raw photo source fields, so renderers can apply `getPhotoBackgroundCss` /
   * `getPhotoCssFilter` / `getAnimatedSunraysStyle` from `lib/personPhoto`. */
  person_photo?: string | null;
  person_photo_nobg?: string | null;
  photo_settings?: import('./personPhoto').PersonPhotoSource['photo_settings'];
  bio?: string;
  website?: string;
  socials?: PersonSocials;
  companies?: PersonCompany[];
  isFeatured: boolean;
}

export interface NormalizedSponsor {
  id: string;
  name: string;
  slug: string;
  logo: string;
  bio?: string;
  website?: string;
  socials?: CompanySocials;
  isSponsor: boolean;
  isPartner: boolean;
  isHotel?: boolean;
  logoHasDarkBg?: boolean;
  /** Preferred cover image for hotels (venue photo / thumbnail / logo). */
  coverImage?: string;
  city?: string;
  country?: string;
  email?: string;
  phone?: string;
  address?: string;
  googleMaps?: string;
  bookingsUrl?: string | null;
  youtubeUrl?: string;
  youtubeVideos?: string[];
  brochureUrl?: string;
}

export interface APIResponse<T> {
  success: boolean;
  data: T;
}

// Navigation API types

export interface NavAPIItem {
  slug: string;
  label: string;
  published: boolean;
}

export interface NavAPICustomLink {
  id: string;
  url: string;
  label: string;
  style: string;
  target: string;
}

export interface NavigationAPIData {
  mainNav: NavAPIItem[];
  footerCol1: NavAPIItem[];
  footerCol2: NavAPIItem[];
  footerCol3: NavAPIItem[];
  footerCol4?: NavAPIItem[];
  footerBuilder?: {
    description?: string;
    headerCustomLinks?: NavAPICustomLink[];
    footerColLabels?: Record<string, string>;
    collectionItems?: { title: string; description: string }[];
    [key: string]: unknown;
  };
}

// CMS Page types

/** Document attached via CMS `documents-list` addon (from uploads). */
export interface CMSDocument {
  name: string;
  url: string;
  path?: string;
  size?: number;
  /** PDF page count when provided by uploads / CMS hydration. */
  pageCount?: number;
  mimeType?: string;
  thumbnailUrl?: string;
  title?: string;
}

export interface CMSBlock {
  id: string;
  type: string;
  addon?: string;
  content?: string;
  title?: string;
  subtitle?: string;
  listType?: string;
  membersListType?: string;
  listLimit?: number;
  items?: CMSSpeakerItem[];
  buttons?: CMSButton[];
  textNodes?: Array<{ id?: string; text: string; icon?: string; link?: string }>;
  /** Hydrated upload items for `documents-list` addon */
  documents?: CMSDocument[];
  /** Storage paths selected in the dashboard (may include items not yet in `documents`) */
  documentPaths?: string[];
  /** Optional form that must be completed before view/download (documents-list gate). */
  requiredFormId?: string | null;
  /** Hydrated gate form when the API includes it on the block. */
  requiredForm?: CMSFormConfig | null;
  formId?: string | null;
  form?: CMSFormConfig | null;
  [key: string]: unknown;
}

export interface CMSButton {
  label: string;
  link?: string;
  action?: string;
  formId?: string;
}

export interface CMSSpeakerItem {
  id: string;
  person_firstname: string;
  person_surname: string;
  person_title?: string;
  person_slug: string;
  person_bio?: string;
  person_photo?: string;
  person_photo_nobg?: string;
  photo_settings?: import('./personPhoto').PersonPhotoSource['photo_settings'];
  person_socials?: PersonSocials;
  is_published?: boolean;
  is_speaker?: boolean;
  is_speaker_featured?: boolean;
  is_team_member?: boolean;
  avatar_seed?: string | null;
}

export interface CMSCompanyItem {
  id: string;
  company_name: string;
  company_slug: string;
  company_bio?: string;
  company_logo?: string;
  logo_settings?: Company['logo_settings'];
  company_country?: string;
  company_socials?: CompanySocials;
  logo_background_white?: boolean;
  company_is_venue?: boolean;
  venue_published?: boolean;
  company_logo_has_dark_bg?: boolean;
  company_published?: boolean;
  company_is_sponsor?: boolean;
  sponsor_published?: boolean;
  company_is_partner?: boolean;
  partner_published?: boolean;
  company_is_organizer?: boolean;
  organizer_published?: boolean;
  company_is_affiliated_hotel?: boolean;
  affiliated_hotel_published?: boolean;
  company_affiliated_hotel_bookings_url?: string | null;
  company_website?: string;
  company_embedded_youtube?: string;
  company_youtube_videos?: string[];
  venue_photo?: string;
  company_thumbnail?: string;
  company_email?: string;
  company_phone?: string;
  company_address?: string;
  company_city?: string;
  company_google_maps?: string;
  brochure_url?: string;
}

export interface CMSFormFieldChoice {
  label: string;
  value: string;
}

export interface CMSFormField {
  id: string;
  name: string;
  /**
   * text | email | phone | number | url | textarea | richtext | select | multiselect |
   * radio | checkbox | checkboxGroup | date | time | datetime | file, plus the display-only
   * `heading` / `paragraph` (text lives in `label`, never submitted).
   */
  type: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  order?: number;
  width?: 'full' | 'half';
  settings?: {
    choices?: CMSFormFieldChoice[];
    /** `file` fields: allowed groups (documents / images / spreadsheets); empty = all. */
    fileTypes?: string[];
    /** `file` fields: per-file limit in MB (1–3, default 3). */
    maxSizeMB?: number;
  };
}

export interface CMSFormConfig {
  id: string;
  form_name: string;
  form_slug: string;
  form_description?: string;
  form_fields: CMSFormField[];
  form_settings?: {
    captcha?: { enabled?: boolean; type?: string };
    successMessage?: string;
  };
  is_active?: boolean;
  is_public?: boolean;
}

export interface CMSPageData {
  id?: string;
  page_type: string;
  page_slug: string;
  page_title: string;
  published: boolean;
  content: {
    blocks: CMSBlock[];
    blockOrder?: string[];
    formConfigs?: Record<string, CMSFormConfig>;
  };
  seo?: SEOSettings;
}

// Blog types (ep-api /blog)

export interface BlogContentBlock {
  id: string;
  type: 'markdown' | 'gallery' | 'carousel' | 'youtube' | 'tweet';
  content?: string;
  title?: string;
  galleryId?: string;
  carouselId?: string;
  videoUrl?: string;
  tweetUrl?: string;
  published?: boolean;
}

export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  content?: string;
  content_blocks?: BlogContentBlock[];
  featured_image: string | null;
  published: boolean;
  published_at: string;
  created_at: string;
  last_updated: string;
  author_id: string;
  meta_title?: string;
  meta_description?: string;
  reading_time: number;
  editors: string[];
  deleted_at?: string | null;
  deleted_by?: string | null;
  seo?: SEOSettings;
}

export interface BlogPublisher {
  name: string;
  id: string;
  slug?: string;
  isTeam?: boolean;
  isSpeaker?: boolean;
  image?: string;
  role: 'author' | 'editor';
}

export interface CMSBlogArticleItem {
  id: string;
  title: string;
  slug: string;
  published_at: string;
  meta_description: string;
  reading_time: number;
  featured_image: string | null;
}
