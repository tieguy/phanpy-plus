// Conversation mode: no link inside a thread navigates in the app. A web link
// in the post text, or a link-preview card, opens in a new tab. Every other
// link (profile name, avatar, @-mention, hashtag, quoted post, timestamp) does
// nothing.
//
// The handlers run in the capture phase and stop propagation, so the click
// never reaches the link's own handler (NameText, for one, opens the account
// sheet from its onClick instead of following its href).

export function webLinkTarget(link) {
  const href = link.getAttribute('href') || '';
  if (!/^https?:\/\//i.test(href)) return null;
  if (link.classList.contains('mention')) return null;
  const inText = !!link.closest('.content');
  const isCard = link.classList.contains('card');
  return inText || isCard ? href : null;
}

function handle(e) {
  if (e.type === 'keydown' && e.key !== 'Enter') return;
  const link = e.target.closest?.('a');
  if (!link || !e.currentTarget.contains(link)) return;
  e.preventDefault();
  e.stopPropagation();
  const href = webLinkTarget(link);
  if (href) window.open(href, '_blank', 'noopener,noreferrer');
}

export default function InertLinks({ children, ...props }) {
  return (
    <div
      class="inert-links"
      onClickCapture={handle}
      onKeyDownCapture={handle}
      {...props}
    >
      {children}
    </div>
  );
}
