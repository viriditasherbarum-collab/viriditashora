
// ══════════════════════════════════════════════════════════
// VIRIDITAS HORA — Service Worker
// Handles background push notifications for planetary hours
// ══════════════════════════════════════════════════════════

const CACHE_NAME = 'viriditas-hora-v1';
const ASSETS = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];

// ── Planet data (duplicated here so SW has no dependencies) ──
const CHALDEAN   = ['Saturn','Jupiter','Mars','Sun','Venus','Mercury','Moon'];
const DAY_RULERS = ['Sun','Moon','Mars','Mercury','Jupiter','Venus','Saturn'];

const HORA_NOTIF = {
  Sun: {
    symbol: '☀',
    affirmation: 'I shine with divine authority. My purpose is clear and my light cannot be extinguished.',
    action: 'Step into natural light. Hold your head high and breathe deeply — you are the light.',
    seeker: 'Psalm 19 · Light a gold candle and speak your intention aloud.'
  },
  Moon: {
    symbol: '☽',
    affirmation: 'I flow with divine rhythm. My intuition is a sacred gift and I trust what I feel.',
    action: 'Drink a glass of water with intention. Bless it and let it carry your prayers.',
    seeker: 'Psalm 23 · Place water near a window and pray over it.'
  },
  Mars: {
    symbol: '♂',
    affirmation: 'I move with divine courage. Every obstacle becomes fuel for my advancement.',
    action: 'Do 10 pushups or a bold action you have been avoiding. Mars requires movement.',
    seeker: 'Psalm 35 · Clap three times and declare: I move forward now.'
  },
  Mercury: {
    symbol: '☿',
    affirmation: 'I speak with divine wisdom. My words open doors and my mind moves with precision.',
    action: 'Write three sentences about your vision by hand. Mercury responds to the written word.',
    seeker: 'Psalm 119:105 · Anoint your wrists with peppermint oil before your next conversation.'
  },
  Jupiter: {
    symbol: '♃',
    affirmation: 'I receive with divine abundance. Blessings multiply as I align with higher law.',
    action: 'Write 5 things you are grateful for right now. Jupiter expands what you acknowledge.',
    seeker: 'Psalm 65 · Light a purple candle and declare increase over your finances and health.'
  },
  Venus: {
    symbol: '♀',
    affirmation: 'I am worthy of deep love. Beauty, harmony, and connection flow to me effortlessly.',
    action: 'Do something beautiful for yourself or another — a kind word, a gesture, a moment of care.',
    seeker: 'Psalm 45 · Anoint your heart with rose oil and speak one thing you love about yourself.'
  },
  Saturn: {
    symbol: '♄',
    affirmation: 'I build with divine discipline. Every foundation I lay is blessed and permanent.',
    action: 'Organize one small thing — a drawer, a list, a task. Saturn rewards order with breakthrough.',
    seeker: 'Psalm 51 · Write what you are releasing and declare: It no longer has power over me.'
  }
};

// ── Calculate current planetary hour ─────────────────────────
function getCurrentPlanetaryHour() {
  const now   = new Date();
  const h     = now.getHours() + now.getMinutes() / 60;
  const dow   = now.getDay();

  // Default sunrise/sunset — service worker cannot access geolocation
  // These are reasonable defaults; the app itself uses real times
  const sunrise = 6.5;
  const sunset  = 19.5;
  const dayLen  = sunset - sunrise;
  const nightLen = 24 - dayLen;

  const startIdx = CHALDEAN.indexOf(DAY_RULERS[dow]);
  const hours = [];
  for (let i = 0; i < 24; i++) {
    const planet    = CHALDEAN[(startIdx + i) % 7];
    const isDaytime = i < 12;
    const start = isDaytime
      ? sunrise + i * (dayLen / 12)
      : sunset  + (i - 12) * (nightLen / 12);
    const end = isDaytime
      ? sunrise + (i + 1) * (dayLen / 12)
      : sunset  + (i - 11) * (nightLen / 12);
    hours.push({ planet, isDaytime, start, end, num: i + 1 });
  }

  const cur = hours.find(hr => h >= hr.start && h < hr.end) || hours[0];
  return cur;
}

// ── Format hour range ─────────────────────────────────────────
function fmtTime(dec) {
  let h = Math.floor(dec) % 24;
  const m = Math.round((dec - Math.floor(dec)) * 60);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
}

// ── INSTALL ───────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ── ACTIVATE ──────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();

  // Schedule the first hour check
  scheduleHourCheck();
});

// ── FETCH (offline support) ───────────────────────────────────
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

// ── PERIODIC HOUR CHECK ───────────────────────────────────────
// Uses setInterval via a keep-alive message pattern
let lastHourNum = -1;

function scheduleHourCheck() {
  // Check every 60 seconds if the hour has changed
  setInterval(() => {
    const cur = getCurrentPlanetaryHour();
    if (cur.num !== lastHourNum) {
      lastHourNum = cur.num;
      fireHourNotification(cur);
    }
  }, 60 * 1000);
}

// ── PUSH EVENT (from server, if added later) ──────────────────
self.addEventListener('push', event => {
  if (event.data) {
    const data = event.data.json();
    event.waitUntil(showNotification(data.planet, data.title, data.body, data.action));
  }
});

// ── NOTIFICATION CLICK ────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const action = event.action;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // If app is open, focus it
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open it
      return clients.openWindow('/');
    })
  );
});

// ── FIRE HOUR NOTIFICATION ────────────────────────────────────
function fireHourNotification(hourData) {
  const planet = hourData.planet;
  const pd     = HORA_NOTIF[planet];
  if (!pd) return;

  const title = `${pd.symbol} ${planet} Hour has begun`;
  const body  = pd.affirmation;
  const tag   = `hora-${hourData.num}`;

  return self.registration.showNotification(title, {
    body,
    icon:   '/icon-192.png',
    badge:  '/icon-192.png',
    tag,
    renotify: true,
    requireInteraction: false,
    silent: false,
    actions: [
      { action: 'open',   title: 'Open App' },
      { action: 'action', title: `\u2726 ${pd.action.substring(0, 40)}...` }
    ],
    data: { planet, action: pd.action, seeker: pd.seeker }
  });
}

// ── MESSAGE FROM APP ──────────────────────────────────────────
// App sends current hour info so SW can sync
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'HOUR_UPDATE') {
    const { planet, hourNum } = event.data;
    if (hourNum !== lastHourNum) {
      lastHourNum = hourNum;
      const cur = getCurrentPlanetaryHour();
      fireHourNotification(cur);
    }
  }
  if (event.data && event.data.type === 'SYNC_HOUR') {
    lastHourNum = event.data.hourNum;
  }
});
