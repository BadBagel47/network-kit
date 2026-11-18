// Shows every notice the admin page can send (F-066), as players see and hear it.
import { NoticeBoard, NOTICE_TEXT } from './network-kit/client/index.js';

const board = new NoticeBoard({ storage: null }); // nothing is remembered here
const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString();
const examples = [
  ['budget-soon', inMinutes(95)],
  ['budget-closed', inMinutes(95)],
  ['timer-soon', inMinutes(10)],
  ['timer-ended', null],
  ['timer-stop-soon', inMinutes(10)],
  ['message', inMinutes(60), 'info', 'Bricks gets an update tonight at 22:00. Finish your games before then.'],
  ['message', inMinutes(60), 'warning', 'The server is being restarted in five minutes.'],
];
let n = 0;
for (const [kind, until, level, text] of examples) {
  const base = NOTICE_TEXT[kind];
  const notice = { kind, level: level ?? base.level, title: level === 'warning' ? 'Warning' : base.title, text: text ?? base.text, until };
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = `${notice.title}${kind === 'message' ? ` (${notice.level})` : ''}`;
  button.addEventListener('click', () => {
    for (const [id, item] of board.open) item.remove(), board.open.delete(id); // one at a time here
    board.show({ ...notice, id: `preview-${n++}` });
  });
  document.getElementById('kinds').append(button);
}
