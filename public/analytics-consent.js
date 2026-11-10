// Legal/public pages do not initialize Firebase solely for disabled analytics.
let firebaseConfigPromise = null;
const loadFirebaseConfig = () => (firebaseConfigPromise ||= import('./firebase-config.js?v=b74586eaa5ef6110')
  .catch((error) => {
    firebaseConfigPromise = null;
    console.warn('Layanan analitik belum dapat dimuat:', error);
    return null;
  }));
let analyticsPromise = null;
let performancePromise = null;
let analyticsInstance = null;
let performanceInstance = null;
let analyticsSetter = null;
let consentAllowed = window.esoriaCookiePreferences?.analytics === true;

const synchronizeCollection = () => {
  if (analyticsInstance && analyticsSetter) analyticsSetter(analyticsInstance, consentAllowed);
  if (performanceInstance) {
    performanceInstance.dataCollectionEnabled = consentAllowed;
    performanceInstance.instrumentationEnabled = consentAllowed;
  }
};

const activateAnalytics = async () => {
  const config = await loadFirebaseConfig();
  if (!config || !consentAllowed) return null;
  const { app, runtimeConfig } = config;
  if (!runtimeConfig.analyticsEnabled || analyticsPromise) return analyticsPromise;
  analyticsPromise = import('https://www.gstatic.com/firebasejs/12.16.0/firebase-analytics.js')
    .then(async ({ getAnalytics, isSupported, logEvent, setAnalyticsCollectionEnabled }) => {
      if (!(await isSupported())) return null;
      const analytics = getAnalytics(app);
      analyticsInstance = analytics;
      analyticsSetter = setAnalyticsCollectionEnabled;
      synchronizeCollection();
      if (consentAllowed) logEvent(analytics, 'consent_analytics_enabled');
      return analytics;
    })
    .catch((error) => {
      analyticsPromise = null;
      console.warn('Analytics tidak dapat diaktifkan:', error);
      return null;
    });
  return analyticsPromise;
};

const activatePerformance = async () => {
  const config = await loadFirebaseConfig();
  if (!config || !consentAllowed) return null;
  const { app, runtimeConfig } = config;
  if (!runtimeConfig.performanceEnabled || performancePromise) return performancePromise;
  performancePromise = import('https://www.gstatic.com/firebasejs/12.16.0/firebase-performance.js')
    .then(({ getPerformance }) => {
      performanceInstance = getPerformance(app);
      synchronizeCollection();
      return performanceInstance;
    })
    .catch((error) => {
      performancePromise = null;
      console.warn('Performance Monitoring tidak dapat diaktifkan:', error);
      return null;
    });
  return performancePromise;
};

const apply = (preferences = window.esoriaCookiePreferences) => {
  consentAllowed = preferences?.analytics === true;
  synchronizeCollection();
  if (consentAllowed) {
    void activateAnalytics();
    void activatePerformance();
  }
};
window.addEventListener('esoria:cookie-consent', (event) => apply(event.detail));
apply();
