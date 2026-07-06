/**
 * Product analytics (Mixpanel) for Wilder Gibson.
 *
 * Anonymous by default — no emails/names. `localStorage` persistence, honours
 * DNT/GPC and an opt-out toggle, and stamps a first-touch acquisition source.
 * Safe no-op when `VITE_MIXPANEL_TOKEN` is unset (dev/preview) or the visitor
 * has opted out. Analytics must never crash the app.
 */
import mixpanel from 'mixpanel-browser';

const MIXPANEL_TOKEN = import.meta.env.VITE_MIXPANEL_TOKEN?.trim() ?? '';
const OPT_OUT_KEY = 'wilder-gibson-analytics-opt-out';

let initialized = false;

/** True when the browser signals Do Not Track or Global Privacy Control. */
function browserSignalsDNT(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === '1' || nav.globalPrivacyControl === true;
}

/** True when the visitor has opted out via the consent toggle. */
function isOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Reduce the browser's "who sent you" signals to one clean acquisition label.
 * An explicit `utm_source` always wins; otherwise map the referring domain to
 * a known source, keep the referrer's own domain for anything unlisted, and
 * return `direct` when there is no referrer.
 */
export function classifyAcquisitionSource(referrer: string, search: string): string {
  try {
    const utm = new URLSearchParams(search).get('utm_source');
    if (utm?.trim()) return utm.trim().toLowerCase();
  } catch {
    // Malformed query string — fall through to the referrer.
  }

  if (!referrer) return 'direct';

  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'direct';
  }

  const from = (...domains: string[]) =>
    domains.some((d) => host === d || host.endsWith(`.${d}`));

  if (from('x.com', 'twitter.com', 't.co')) return 'x';
  if (/(^|\.)google\./.test(host)) return 'google';
  if (from('youtube.com', 'youtu.be')) return 'youtube';
  if (from('reddit.com')) return 'reddit';
  if (from('github.com')) return 'github';
  if (from('linkedin.com', 'lnkd.in')) return 'linkedin';
  if (from('facebook.com', 'fb.com')) return 'facebook';
  if (from('news.ycombinator.com')) return 'hackernews';

  return host;
}

/** Initialise analytics. Call once at app startup. */
export function initAnalytics(): void {
  if (!MIXPANEL_TOKEN || initialized) return;

  try {
    mixpanel.init(MIXPANEL_TOKEN, {
      debug: import.meta.env.DEV,
      track_pageview: false, // events are fired explicitly
      persistence: 'localStorage',
      // Mixpanel resolves coarse geo ($country_code/$region/$city) from the
      // request IP at ingestion; not persisted as an event property.
      ip: true,
    });

    if (browserSignalsDNT() || isOptedOut()) {
      mixpanel.opt_out_tracking();
    }

    // First-touch acquisition source, stamped once so it survives return
    // visits and rides on every event.
    if (typeof document !== 'undefined' && typeof window !== 'undefined') {
      mixpanel.register_once({
        acquisition_source: classifyAcquisitionSource(
          document.referrer,
          window.location.search
        ),
      });
    }

    initialized = true;
  } catch {
    // Analytics must never crash the app.
  }
}

/** Track an event. Safe no-op if not initialised or opted out. */
export function track(name: string, properties?: Record<string, unknown>): void {
  if (!initialized) return;
  try {
    mixpanel.track(name, properties);
  } catch {
    // Silent fail.
  }
}
