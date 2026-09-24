(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const nav = $('#nav');
  const burger = $('#burger');
  const navLinks = $('#navLinks');
  const status = $('#calendarStatus');
  const summary = $('#calendarSummary');
  const months = $('#calendarMonths');
  let signature = null;
  let requestRunning = false;

  function syncNav() {
    nav.classList.toggle('scrolled', window.scrollY > 8 || nav.classList.contains('menu-open'));
  }
  window.addEventListener('scroll', syncNav, { passive: true });
  syncNav();
  burger.addEventListener('click', () => {
    const open = nav.classList.toggle('menu-open');
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  });
  navLinks.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    nav.classList.remove('menu-open');
    burger.setAttribute('aria-expanded', 'false');
    syncNav();
  }));

  function dateParts(value) {
    const date = new Date(`${String(value || '')}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return { month: 'TBA', day: '—', full: 'Date to be announced', group: 'Date to be announced' };
    return {
      month: new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(date).toUpperCase(),
      day: new Intl.DateTimeFormat('en-US', { day: '2-digit', timeZone: 'UTC' }).format(date),
      full: new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date),
      group: new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date),
    };
  }

  function makeEventCard(event) {
    const date = dateParts(event.date);
    const card = document.createElement('article');
    card.className = 'public-event-card';

    const badge = document.createElement('div');
    badge.className = 'public-event-date';
    badge.setAttribute('aria-hidden', 'true');
    const month = document.createElement('span');
    month.textContent = date.month;
    const day = document.createElement('strong');
    day.textContent = date.day;
    badge.append(month, day);

    const content = document.createElement('div');
    content.className = 'public-event-content';
    const kicker = document.createElement('p');
    kicker.className = 'public-event-kicker';
    const trekLabel = event.trek === 'alibaba' ? 'Alibaba HQ · Hangzhou' : event.trek === 'refinery' ? 'Private Refinery Island' : '';
    kicker.textContent = trekLabel ? `Hi World Club · ${trekLabel}` : 'Hi World Club · Upcoming';
    const title = document.createElement('h3');
    title.textContent = event.title || 'Club gathering';
    const timeLine = document.createElement('p');
    timeLine.className = 'public-event-time';
    const time = document.createElement('time');
    time.dateTime = event.date || '';
    time.textContent = date.full;
    timeLine.appendChild(time);
    if (event.time) timeLine.append(` · ${event.time} Hangzhou time`);
    const location = document.createElement('p');
    location.className = 'public-event-location';
    location.textContent = event.location || 'Location to be announced';
    content.append(kicker, title, timeLine, location);

    if (event.description) {
      const description = document.createElement('p');
      description.className = 'public-event-description';
      description.textContent = event.description;
      content.appendChild(description);
    }
    if (event.url) {
      const link = document.createElement('a');
      link.className = 'public-event-link';
      link.href = event.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Event details ↗';
      content.appendChild(link);
    }
    card.append(badge, content);
    return card;
  }

  function showEmpty() {
    summary.textContent = 'The calendar is checked regularly as new events are added.';
    status.hidden = true;
    months.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'calendar-empty';
    const mark = document.createElement('span');
    mark.className = 'calendar-empty-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '✳';
    const copy = document.createElement('div');
    const heading = document.createElement('h3');
    heading.textContent = 'Nothing on the calendar just yet.';
    const message = document.createElement('p');
    message.textContent = 'Check back soon—we will post the next trek, workshop, and volunteer shift here.';
    const link = document.createElement('a');
    link.className = 'btn btn-sm';
    link.href = '/#moments';
    link.textContent = 'Explore club moments';
    copy.append(heading, message, link);
    empty.append(mark, copy);
    months.appendChild(empty);
  }

  function render(events) {
    if (!events.length) {
      showEmpty();
      return;
    }
    summary.textContent = `${events.length} upcoming ${events.length === 1 ? 'event' : 'events'} · the calendar updates automatically.`;
    status.hidden = true;
    months.replaceChildren();

    const groups = new Map();
    for (const event of events) {
      const group = dateParts(event.date).group;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(event);
    }
    for (const [label, rows] of groups) {
      const section = document.createElement('section');
      section.className = 'calendar-month';
      const heading = document.createElement('h3');
      heading.className = 'calendar-month-title';
      heading.textContent = label;
      const grid = document.createElement('div');
      grid.className = 'public-event-grid';
      grid.setAttribute('aria-label', `${label} events`);
      rows.forEach((event) => grid.appendChild(makeEventCard(event)));
      section.append(heading, grid);
      months.appendChild(section);
    }
  }

  async function loadEvents() {
    if (requestRunning || document.hidden) return;
    requestRunning = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('/api/events?limit=100', { cache: 'no-store', signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Calendar request failed (${response.status}).`);
      const events = Array.isArray(data.events) ? data.events : [];
      const nextSignature = JSON.stringify(events);
      if (nextSignature !== signature) {
        signature = nextSignature;
        render(events);
      }
    } catch (error) {
      status.hidden = false;
      status.classList.add('error');
      status.textContent = error.name === 'AbortError'
        ? 'The calendar request timed out. Please try again in a moment.'
        : 'The event calendar is temporarily unavailable. Please try again shortly.';
      summary.textContent = 'We could not reach the calendar just now.';
      signature = null;
    } finally {
      clearTimeout(timeout);
      requestRunning = false;
    }
  }

  loadEvents();
  window.setInterval(loadEvents, 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadEvents(); });
})();
