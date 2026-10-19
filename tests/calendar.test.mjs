import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calendarWindow,anchorFor} from '../src/calendar.ts';
const defaults={frequency:'WEEKLY',timeZone:'UTC',weekday:1,monthDay:1,generationHour:9,generationMinute:0,anchorDate:'2026-10-12'};

test('weekly generation keeps local wall time across daylight-saving changes',()=>{
  const settings={...defaults,timeZone:'Europe/Berlin',anchorDate:'2026-10-19'};
  const window=calendarWindow(settings,new Date('2026-10-23T12:00:00Z'));
  assert.equal(window.opensAt.toISOString(),'2026-10-19T07:00:00.000Z');
  assert.equal(window.closesAt.toISOString(),'2026-10-26T08:00:00.000Z');
});
test('fortnightly dates remain anchored and exact scheduled boundaries enter the next cycle',()=>{
  const settings={...defaults,frequency:'FORTNIGHTLY'};
  const before=calendarWindow(settings,new Date('2026-10-25T12:00:00Z'));
  assert.equal(before.opensAt.toISOString(),'2026-10-12T09:00:00.000Z');
  assert.equal(before.closesAt.toISOString(),'2026-10-26T09:00:00.000Z');
  const at=calendarWindow(settings,before.closesAt);
  assert.equal(at.opensAt.toISOString(),'2026-10-26T09:00:00.000Z');
  assert.equal(at.closesAt.toISOString(),'2026-11-09T09:00:00.000Z');
});
test('calendar months clamp month-end without drifting into a 30-day interval',()=>{
  const settings={...defaults,frequency:'MONTHLY',monthDay:31};
  const january=calendarWindow(settings,new Date('2027-02-15T12:00:00Z'));
  assert.equal(january.opensAt.toISOString(),'2027-01-31T09:00:00.000Z');
  assert.equal(january.closesAt.toISOString(),'2027-02-28T09:00:00.000Z');
  const february=calendarWindow(settings,new Date('2027-03-15T12:00:00Z'));
  assert.equal(february.opensAt.toISOString(),'2027-02-28T09:00:00.000Z');
  assert.equal(february.closesAt.toISOString(),'2027-03-31T09:00:00.000Z');
  assert.equal(calendarWindow(settings,new Date('2028-03-01T00:00:00Z')).opensAt.toISOString(),'2028-02-29T09:00:00.000Z');
});
test('a DST gap shifts forward and a repeated local hour selects its earlier instance',()=>{
  const gap={...defaults,timeZone:'Europe/Berlin',weekday:7,generationHour:2,generationMinute:30,anchorDate:'2027-03-21'};
  const spring=calendarWindow(gap,new Date('2027-03-28T03:00:00Z'));
  assert.equal(spring.opensAt.toISOString(),'2027-03-28T01:30:00.000Z');
  const fold={...gap,anchorDate:'2026-10-18'};
  const autumn=calendarWindow(fold,new Date('2026-10-25T02:00:00Z'));
  assert.equal(autumn.opensAt.toISOString(),'2026-10-25T00:30:00.000Z');
});
test('weekday and clock configuration determine the anchor, not the server timezone',()=>{
  const settings={...defaults,timeZone:'America/New_York',weekday:5,generationHour:17};
  assert.equal(anchorFor(settings,new Date('2026-10-16T20:00:00Z')),'2026-10-09');
  assert.equal(anchorFor(settings,new Date('2026-10-16T22:00:00Z')),'2026-10-16');
});
