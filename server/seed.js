'use strict';

/**
 * Sample club, used when the desk is empty so the first open isn't a blank page.
 * Dates are relative to "now" so the activity feed stays fresh.
 */

function ago({ days = 0, hours = 0, minutes = 0 }) {
  const d = new Date(Date.now() - ((days * 24 + hours) * 60 + minutes) * 60_000);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

function t(days, hours = 0, minutes = 0) {
  return ago({ days, hours, minutes });
}

function buildSeed() {
  const applications = [
    { name: 'Lin Chen', wc: 'linchen_zju', org: 'Zhejiang University', interests: ['treks', 'workshops'], status: 'new', msg: 'Saw the Alibaba trek poster in the Yuquan canteen. I can do weekdays after 4.', notes: '', created_at: t(0, 5, 10) },
    { name: 'Chen Yu', wc: 'cyu_explore', org: 'Zhejiang University', interests: ['treks'], status: 'new', msg: 'Exchange student from Toronto. Keen on the refinery island if PPE is provided — the site said it is.', notes: '', created_at: t(0, 2, 40) },
    { name: 'Noah Kim', wc: 'noahkim88', org: 'NYU Shanghai', interests: ['treks', 'workshops'], status: 'new', msg: 'In Hangzhou for the semester. The deck workshop fits a pitch I have on Friday.', notes: '', created_at: t(1, 4, 20) },
    { name: 'Yuki Tanaka', wc: 'yuki.t.caa', org: '', interests: ['workshops'], status: 'new', msg: '', notes: 'Thin application — follow up on WeChat for school and which deck they want torn down.', created_at: t(1, 6, 5) },
    { name: 'Wei Zhang', wc: 'wei_zhang_hz', org: 'Zhejiang University of Technology', interests: ['csr'], status: 'new', msg: 'I can sort books on Saturdays. I have a car if a delivery run needs one.', notes: '', created_at: t(5, 3, 12) },
    { name: 'Maya Okonkwo', wc: 'maya.oko', org: 'Westlake University', interests: ['treks', 'csr'], status: 'reviewing', msg: 'Materials science. The refinery control-room walkthrough is the one I want. Happy to help label English books too.', notes: 'Strong fit for the island trek. Ask if she can make the Thursday safety call.', created_at: t(2, 8, 15), updated_at: t(0, 1, 20) },
    { name: 'Priya Nair', wc: 'priya.nair', org: 'Westlake University', interests: ['treks', 'workshops', 'csr'], status: 'reviewing', msg: 'All three, honestly. I ran a book drive in Bangalore — I can share the sorting sheet we used.', notes: 'Wants to send the sorting sheet. Worth a yes.', created_at: t(5, 6, 40), updated_at: t(1, 3, 10) },
    { name: 'Lucas Ferreira', wc: 'lucasf_zju', org: 'Zhejiang University', interests: ['treks'], status: 'reviewing', msg: 'Civil engineering. Island logistics day is exactly my thesis topic.', notes: '', created_at: t(3, 5, 18), updated_at: t(2, 2, 5) },
    { name: 'Fatima Al-Sayed', wc: 'fatima.as', org: 'Hangzhou Dianzi University', interests: ['treks', 'csr'], status: 'reviewing', msg: 'Evenings and Sundays. WeChat is the best way — I miss email.', notes: '', created_at: t(6, 4, 45), updated_at: t(3, 1, 30) },
    { name: 'Sofia Alvarez', wc: 'sofia.alv', org: 'NYU Shanghai (exchange)', interests: ['workshops'], status: 'accepted', msg: 'Bringing a 12-slide deck that currently has two titles. Please be honest.', notes: 'Accepted for session 2. Remind her to bring a printed storyboard.', created_at: t(8, 7, 5), updated_at: t(2, 4, 10) },
    { name: 'Aiko Sato', wc: 'aiko.sato', org: 'China Academy of Art', interests: ['workshops', 'csr'], status: 'accepted', msg: 'I illustrate. I can make the book-drive labels if someone writes the categories.', notes: 'Pair with Priya on the label sheet.', created_at: t(12, 5, 0), updated_at: t(6, 2, 15) },
    { name: 'Hannah Berg', wc: 'hannahberg', org: 'Zhejiang University', interests: ['csr'], status: 'accepted', msg: 'Saturday sorting shifts only. I already pledged 6 picture books under my name.', notes: '', created_at: t(14, 3, 30), updated_at: t(9, 1, 0) },
    { name: 'Ananya Shah', wc: 'ananya.shah', org: 'Westlake University', interests: ['csr', 'workshops'], status: 'accepted', msg: 'English-learning books are what my cousin’s school asked for. Count me in for the next delivery.', notes: '', created_at: t(11, 8, 20), updated_at: t(7, 3, 40) },
    { name: 'Mei Lin', wc: 'meilin.hz2', org: 'Hangzhou No.2 High School (alum)', interests: ['csr'], status: 'accepted', msg: 'Alumni volunteer. I know the librarian at a primary school in Xiaoshan who is waiting on a delivery.', notes: 'Xiaoshan contact is warm. Don’t lose this thread.', created_at: t(18, 6, 12), updated_at: t(10, 2, 25) },
    { name: 'James Whitaker', wc: 'jwhitaker', org: 'Zhejiang University', interests: ['treks'], status: 'waitlisted', msg: 'Alibaba day clashes with a lab. Refinery island works. If both are full, waitlist me for whichever opens.', notes: 'Confirmed on the island. Alibaba waitlist is a backup only.', created_at: t(9, 4, 44), updated_at: t(4, 2, 10) },
    { name: 'Omar Hassan', wc: 'omar.hassan', org: 'Hangzhou Dianzi University', interests: ['treks'], status: 'declined', msg: 'Can the club arrange a private tour for my startup team of 8?', notes: 'Asked for a closed corporate tour, not a student trek. Pointed him to the next open cohort.', created_at: t(16, 9, 0), updated_at: t(12, 3, 20) },
  ];

  const pledges = [
    { name: 'Hannah Berg', genre: "Children's picture books", qty: 6, status: 'received', notes: 'Dropped at the Saturday sort.', created_at: t(14, 2, 10), updated_at: t(9, 5, 0) },
    { name: 'Anonymous', genre: 'STEM & science', qty: 3, status: 'pledged', notes: '', created_at: t(1, 2, 15) },
    { name: 'Jun', genre: 'English learning', qty: 4, status: 'received', notes: '', created_at: t(10, 4, 0), updated_at: t(8, 3, 0) },
    { name: 'Mei Lin', genre: "Children's picture books", qty: 8, status: 'received', notes: 'Boxed for the Xiaoshan run.', created_at: t(9, 6, 20), updated_at: t(7, 1, 10) },
    { name: 'Aiko Sato', genre: 'Classics', qty: 2, status: 'pledged', notes: '', created_at: t(3, 7, 25) },
    { name: 'Priya Nair', genre: 'English learning', qty: 5, status: 'pledged', notes: 'Will bring them to the next sorting shift.', created_at: t(5, 5, 40) },
    { name: 'Wei Zhang', genre: 'Middle-grade fiction', qty: 4, status: 'pledged', notes: '', created_at: t(4, 3, 12) },
    { name: 'Anonymous', genre: 'STEM & science', qty: 2, status: 'received', notes: '', created_at: t(7, 8, 5), updated_at: t(6, 2, 0) },
    { name: 'Lin Chen', genre: 'STEM & science', qty: 1, status: 'pledged', notes: '', created_at: t(0, 4, 50) },
    { name: 'Sofia Alvarez', genre: 'Classics', qty: 3, status: 'pledged', notes: '', created_at: t(2, 6, 33) },
    { name: 'Ananya Shah', genre: 'English learning', qty: 6, status: 'received', notes: '', created_at: t(8, 4, 18), updated_at: t(6, 5, 0) },
    { name: 'Noah Kim', genre: 'Middle-grade fiction', qty: 2, status: 'pledged', notes: '', created_at: t(1, 5, 8) },
    { name: 'Club shelf', genre: 'Classics', qty: 5, status: 'received', notes: 'Review copies from the reading shelf.', created_at: t(20, 3, 0), updated_at: t(18, 2, 0) },
    { name: 'Maya Okonkwo', genre: 'STEM & science', qty: 3, status: 'pledged', notes: '', created_at: t(2, 9, 40) },
    { name: 'Anonymous', genre: "Children's picture books", qty: 4, status: 'cancelled', notes: 'Donor wrote back — books were damaged in shipping.', created_at: t(6, 7, 15), updated_at: t(5, 2, 40) },
    { name: 'Fatima Al-Sayed', genre: 'English learning', qty: 2, status: 'pledged', notes: '', created_at: t(6, 3, 55) },
    { name: 'James Whitaker', genre: 'Middle-grade fiction', qty: 1, status: 'pledged', notes: 'Said he would drop it after lab week. Still open.', created_at: t(11, 4, 5) },
    { name: 'Yuki Tanaka', genre: "Children's picture books", qty: 3, status: 'pledged', notes: '', created_at: t(1, 7, 22) },
    { name: 'Lucas Ferreira', genre: 'STEM & science', qty: 2, status: 'received', notes: '', created_at: t(3, 2, 48), updated_at: t(2, 8, 0) },
    { name: 'Anonymous', genre: 'Classics', qty: 1, status: 'pledged', notes: '', created_at: t(0, 3, 5) },
    { name: 'Chen Yu', genre: 'English learning', qty: 2, status: 'pledged', notes: '', created_at: t(0, 2, 55) },
    { name: 'Omar Hassan', genre: 'STEM & science', qty: 1, status: 'cancelled', notes: 'Withdrawn with the declined application.', created_at: t(15, 4, 0), updated_at: t(12, 3, 30) },
  ];

  const passes = [
    { name: 'Sofia Alvarez', track: 'Craft', status: 'active', notes: '', created_at: t(2, 4, 0) },
    { name: 'Aiko Sato', track: 'Impact', status: 'active', notes: '', created_at: t(6, 2, 20) },
    { name: 'Hannah Berg', track: 'Impact', status: 'active', notes: '', created_at: t(9, 1, 15) },
    { name: 'Ananya Shah', track: 'All-rounder', status: 'active', notes: '', created_at: t(7, 3, 50) },
    { name: 'Mei Lin', track: 'Impact', status: 'active', notes: '', created_at: t(10, 2, 30) },
    { name: 'Lin Chen', track: 'Treks', status: 'active', notes: '', created_at: t(0, 4, 40) },
    { name: 'Maya Okonkwo', track: 'Treks', status: 'active', notes: '', created_at: t(1, 8, 5) },
    { name: 'James Whitaker', track: 'Treks', status: 'active', notes: '', created_at: t(4, 2, 18) },
    { name: 'Noah Kim', track: 'Craft', status: 'active', notes: '', created_at: t(1, 4, 40) },
    { name: 'Priya Nair', track: 'All-rounder', status: 'active', notes: '', created_at: t(5, 6, 10) },
    { name: 'Wei Zhang', track: 'Impact', status: 'active', notes: '', created_at: t(4, 3, 33) },
    { name: 'Guest Lecturer', track: 'Craft', status: 'revoked', notes: 'Issued by mistake at the open house.', created_at: t(20, 5, 0), updated_at: t(19, 2, 0) },
    { name: 'Lucas Ferreira', track: 'Treks', status: 'active', notes: '', created_at: t(3, 5, 5) },
    { name: 'Yuki Tanaka', track: 'Craft', status: 'active', notes: '', created_at: t(1, 6, 18) },
  ];

  const reservations = [
    { name: 'Lin Chen', wc: 'linchen_zju', trek: 'alibaba', status: 'confirmed', notes: '', created_at: t(0, 4, 55) },
    { name: 'Maya Okonkwo', wc: 'maya.oko', trek: 'alibaba', status: 'confirmed', notes: '', created_at: t(1, 7, 40) },
    { name: 'Noah Kim', wc: 'noahkim88', trek: 'alibaba', status: 'confirmed', notes: '', created_at: t(1, 4, 10) },
    { name: 'Sofia Alvarez', wc: 'sofia.alv', trek: 'alibaba', status: 'checked-in', notes: 'Visitor badge picked up at the Thursday desk.', created_at: t(8, 6, 0), updated_at: t(1, 9, 0) },
    { name: 'Aiko Sato', wc: 'aiko.sato', trek: 'alibaba', status: 'confirmed', notes: '', created_at: t(6, 3, 15) },
    { name: 'Hannah Berg', wc: 'hannahberg', trek: 'alibaba', status: 'confirmed', notes: '', created_at: t(9, 2, 45) },
    { name: 'Priya Nair', wc: 'priya.nair', trek: 'alibaba', status: 'confirmed', notes: '', created_at: t(5, 5, 20) },
    { name: 'Wei Zhang', wc: 'wei_zhang_hz', trek: 'alibaba', status: 'waitlisted', notes: 'Can drive a book box the same weekend if a seat does not open.', created_at: t(4, 3, 2) },
    { name: 'James Whitaker', wc: 'jwhitaker', trek: 'alibaba', status: 'waitlisted', notes: 'Backup only — lab clash. Island seat is the real one.', created_at: t(4, 2, 8) },
    { name: 'Lucas Ferreira', wc: 'lucasf_zju', trek: 'alibaba', status: 'confirmed', notes: '', created_at: t(3, 4, 55) },
    { name: 'Chen Yu', wc: 'cyu_explore', trek: 'alibaba', status: 'confirmed', notes: '', created_at: t(0, 2, 28) },
    { name: 'Fatima Al-Sayed', wc: 'fatima.as', trek: 'alibaba', status: 'confirmed', notes: '', created_at: t(3, 1, 12) },
    { name: 'Ananya Shah', wc: 'ananya.shah', trek: 'alibaba', status: 'cancelled', notes: 'Switched to the book drive that weekend.', created_at: t(7, 4, 30), updated_at: t(3, 6, 0) },
    { name: 'Mei Lin', wc: 'meilin.hz2', trek: 'alibaba', status: 'confirmed', notes: '', created_at: t(10, 1, 40) },
    { name: 'Omar Hassan', wc: 'omar.hassan', trek: 'alibaba', status: 'cancelled', notes: 'Released with the declined application.', created_at: t(15, 3, 0), updated_at: t(12, 3, 25) },
    { name: 'Yuki Tanaka', wc: 'yuki.t.caa', trek: 'alibaba', status: 'confirmed', notes: '', created_at: t(1, 6, 8) },
    { name: 'Jun Park', wc: 'jun.park', trek: 'alibaba', status: 'confirmed', notes: '', created_at: t(2, 3, 16) },
    { name: 'Elena Voss', wc: 'elena.voss', trek: 'alibaba', status: 'confirmed', notes: '', created_at: t(2, 8, 42) },
    { name: 'Hao Ming', wc: 'haoming', trek: 'alibaba', status: 'confirmed', notes: '', created_at: t(3, 9, 5) },
    { name: 'Sara Iqbal', wc: 'sara.iqbal', trek: 'alibaba', status: 'confirmed', notes: '', created_at: t(4, 7, 28) },

    { name: 'Maya Okonkwo', wc: 'maya.oko', trek: 'refinery', status: 'confirmed', notes: '', created_at: t(2, 7, 50) },
    { name: 'Lucas Ferreira', wc: 'lucasf_zju', trek: 'refinery', status: 'confirmed', notes: 'Wants the marine terminal hour for his thesis notes.', created_at: t(3, 4, 40) },
    { name: 'James Whitaker', wc: 'jwhitaker', trek: 'refinery', status: 'confirmed', notes: '', created_at: t(4, 1, 55) },
    { name: 'Chen Yu', wc: 'cyu_explore', trek: 'refinery', status: 'waitlisted', notes: 'Took the Alibaba seat. Island if someone drops.', created_at: t(0, 2, 20) },
    { name: 'Priya Nair', wc: 'priya.nair', trek: 'refinery', status: 'checked-in', notes: 'Safety induction completed online.', created_at: t(5, 4, 35), updated_at: t(1, 3, 45) },
    { name: 'Fatima Al-Sayed', wc: 'fatima.as', trek: 'refinery', status: 'confirmed', notes: '', created_at: t(6, 2, 48) },
    { name: 'Noah Kim', wc: 'noahkim88', trek: 'refinery', status: 'cancelled', notes: 'Lab conflict. Kept the Alibaba seat.', created_at: t(2, 5, 10), updated_at: t(1, 3, 5) },
    { name: 'Lin Chen', wc: 'linchen_zju', trek: 'refinery', status: 'confirmed', notes: '', created_at: t(0, 4, 48) },
    { name: 'Hao Ming', wc: 'haoming', trek: 'refinery', status: 'confirmed', notes: '', created_at: t(2, 9, 12) },
    { name: 'Sara Iqbal', wc: 'sara.iqbal', trek: 'refinery', status: 'confirmed', notes: '', created_at: t(3, 7, 8) },
    { name: 'Elena Voss', wc: 'elena.voss', trek: 'refinery', status: 'waitlisted', notes: '', created_at: t(2, 8, 20) },
    { name: 'Jun Park', wc: 'jun.park', trek: 'refinery', status: 'confirmed', notes: '', created_at: t(4, 6, 14) },
  ];

  const collections = { applications, pledges, passes, reservations };
  const typeOf = { applications: 'application', pledges: 'pledge', passes: 'pass', reservations: 'reservation' };
  const initialOf = { application: 'new', pledge: 'pledged', pass: 'active', reservation: 'confirmed' };

  let seq = 1;
  for (const list of Object.values(collections)) {
    for (const row of list) {
      row.id = seq++;
      row.notes = row.notes || '';
      row.updated_at = row.updated_at || row.created_at;
    }
  }

  const activity = [];
  const trekName = (id) => (id === 'refinery' ? 'Refinery Island' : 'Alibaba HQ');

  function createdSummary(type, row) {
    if (type === 'application') return `${row.name} applied to join`;
    if (type === 'pledge') return `${row.name} pledged ${row.qty} × ${row.genre}`;
    if (type === 'pass') return `Visitor pass issued to ${row.name} · ${row.track}`;
    if (row.status === 'waitlisted') return `${row.name} joined the ${trekName(row.trek)} waitlist`;
    return `${row.name} reserved ${trekName(row.trek)}`;
  }

  function statusSummary(type, row) {
    if (type === 'reservation') {
      const trek = trekName(row.trek);
      if (row.status === 'cancelled') return `${row.name} released their ${trek} seat`;
      if (row.status === 'checked-in') return `${row.name} checked in for ${trek}`;
      return `${row.name} marked ${row.status} for ${trek}`;
    }
    if (type === 'pledge') {
      if (row.status === 'received') return `${row.name}'s ${row.qty} books marked received`;
      if (row.status === 'cancelled') return `${row.name}'s pledge cancelled`;
    }
    if (type === 'pass' && row.status === 'revoked') return `${row.name}'s visitor pass revoked`;
    if (type === 'application') return `${row.name} marked ${row.status}`;
    return `${row.name} updated`;
  }

  for (const [collection, list] of Object.entries(collections)) {
    const type = typeOf[collection];
    for (const row of list) {
      const openedAs = type === 'reservation' && row.status === 'waitlisted' ? 'waitlisted' : initialOf[type];
      activity.push({
        id: seq++,
        type,
        action: 'created',
        summary: createdSummary(type, { ...row, status: openedAs }),
        ref_id: row.id,
        created_at: row.created_at,
      });
      if (row.status !== openedAs) {
        activity.push({
          id: seq++,
          type,
          action: 'status',
          summary: statusSummary(type, row),
          ref_id: row.id,
          created_at: row.updated_at,
        });
      }
    }
  }

  activity.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id);

  return {
    applications,
    pledges,
    passes,
    reservations,
    activity,
    seq,
    meta: { demo: true, seeded_at: new Date().toISOString() },
  };
}

module.exports = { buildSeed };
