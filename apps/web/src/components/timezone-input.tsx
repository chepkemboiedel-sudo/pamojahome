'use client';
import { useEffect, useState } from 'react';

/** Sends the browser's time zone so due dates and Mondays match the household (RC-13). */
export function TimezoneInput() {
  const [tz, setTz] = useState('UTC');
  useEffect(() => setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'), []);
  return <input type="hidden" name="timezone" value={tz} />;
}
