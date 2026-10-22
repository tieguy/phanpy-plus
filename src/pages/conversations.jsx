import { Trans, useLingui } from '@lingui/react/macro';

import useTitle from '../utils/useTitle';

// The conversation list. In conversation mode this is the only page, so the
// header carries no navigation menu and no home link.
function Conversations() {
  const { t } = useLingui();
  useTitle(t`Conversations`, '/conversations');

  return (
    <div id="conversations-page" class="deck-container" tabIndex="-1">
      <div class="timeline-deck deck">
        <header>
          <div class="header-grid">
            <div class="header-side" />
            <h1>
              <Trans>Conversations</Trans>
            </h1>
            <div class="header-side" />
          </div>
        </header>
        <main>
          <p class="ui-state insignificant">
            <Trans>Conversations will appear here.</Trans>
          </p>
        </main>
      </div>
    </div>
  );
}

export default Conversations;
