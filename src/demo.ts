import { DEFAULT_PREFERENCES, EMPTY_PROFILE, MemberState } from './types';
import { demoSeating } from './seating';

// Deliberately fictional. These are never uploaded to a server.
export function createDemo(): MemberState {
  const now = new Date();
  const ago = (hours: number) => new Date(now.getTime() - hours * 3600000).toISOString();
  return {
    profile: { ...EMPTY_PROFILE, name: 'ישראל ישראלי', firstName: 'ישראל', lastName: 'ישראלי', torahName: 'ישראל בן אברהם', barMitzvahParasha: 'לך לך', yahrzeits: [], children: [] },
    preferences: { ...DEFAULT_PREFERENCES }, readIds: [], healingPrayers: [], seating: demoSeating(),
    messages: [
      { id: 'demo-weekly', category: 'weekly', title: 'נפגשים לתפילה וללימוד', body: 'לוח לדוגמה בלבד\n\nשחרית בימי חול  ·  06:30\nשחרית בשבת  ·  08:00\nשיעור פרשת השבוע  ·  ביום חמישי ב־20:30\n\nזמני התפילות האמיתיים יפורסמו כאן על ידי הגבאים.', author: 'גבאי הקהילה · הדגמה', createdAt: ago(1), pinned: true, replies: [] },
      { id: 'demo-celebration', category: 'celebration', title: 'מזל טוב למשפחת כהן!', body: 'שמחים עם משפחת כהן לרגל בר המצווה של בנם. שתזכו לגדלו לתורה, לחופה ולמעשים טובים.\n\nזוהי הודעה לדוגמה; אפשר לפתוח ולהוסיף ברכה.', author: 'גבאי הקהילה · הדגמה', createdAt: ago(3), pinned: false, replies: [{ id: 'demo-reply', author: 'משפחת לוי · הדגמה', body: 'מזל טוב והרבה נחת!', createdAt: ago(2) }] },
      { id: 'demo-event', category: 'event', title: 'מקום להיפגש, גם באמצע השבוע', body: 'כאן יופיעו הזמנות לאירועים, שיעורים ופעילויות בבית הכנסת.\n\nהודעה זו נועדה להמחיש את לוח הקהילה.', author: 'גבאי הקהילה · הדגמה', createdAt: ago(6), pinned: false, replies: [] },
      { id: 'demo-condolence', category: 'condolence', title: 'משתתפים בצער משפחת לוי', body: 'הקהילה משתתפת בצער המשפחה. המקום ינחם אתכם בתוך שאר אבלי ציון וירושלים.\n\nהודעת הדגמה עם שמות בדויים.', author: 'גבאי הקהילה · הדגמה', createdAt: ago(23), pinned: false, replies: [] },
    ],
  };
}
