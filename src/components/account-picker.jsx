// Shared account rows for the account-agnostic actions surfaces: the compose
// target checkboxes, the Profile submenu, and the "Boost/Favourite/Reply as…"
// menus. One presentational row (avatar + handle + network badge) with a
// checkbox-list variant and a menu-items variant around it.
import './account-picker.css';

import { MenuItem } from '@szhsin/react-menu';
import punycode from 'punycode/';

import { isBlueskyAccount } from '../utils/bluesky';

import Avatar from './avatar';
import Icon from './icon';

export function accountLabel(account) {
  const acct = account.info?.acct || account.info?.username || '';
  const unicodeAcct = /@/.test(acct) ? acct : `${acct}@${account.instanceURL}`;
  try {
    return `@${punycode.toUnicode(unicodeAcct)}`;
  } catch (e) {
    return `@${unicodeAcct}`;
  }
}

export function AccountRow({ account }) {
  const bluesky = isBlueskyAccount(account);
  return (
    <span class="account-picker-row">
      <Avatar url={account.info?.avatarStatic || account.info?.avatar} />
      <span class="account-picker-acct">{accountLabel(account)}</span>
      <span
        class="network-badge"
        data-network={bluesky ? 'bluesky' : 'mastodon'}
      >
        <Icon
          icon={bluesky ? 'bluesky' : 'mastodon'}
          size="s"
          alt={bluesky ? 'Bluesky' : 'Mastodon'}
        />
      </span>
    </span>
  );
}

// Checkbox-list variant (compose targets). `selectedIDs` is a Set of
// account info.ids; onToggle(account, checked) reports changes.
export function AccountPickerCheckboxes({
  accounts,
  selectedIDs,
  onToggle,
  disabled,
}) {
  return (
    <ul class="account-picker">
      {accounts.map((account) => (
        <li key={account.info.id}>
          <label class="account-picker-option">
            <input
              type="checkbox"
              checked={selectedIDs.has(account.info.id)}
              disabled={disabled}
              onChange={(e) => onToggle(account, e.target.checked)}
            />
            <AccountRow account={account} />
          </label>
        </li>
      ))}
    </ul>
  );
}

// Menu-items variant (Profile submenu, "… as" action menus). Renders one
// MenuItem per account; onSelect(account) fires on click.
export function AccountPickerMenuItems({ accounts, onSelect }) {
  return accounts.map((account) => (
    <MenuItem key={account.info.id} onClick={() => onSelect(account)}>
      <AccountRow account={account} />
    </MenuItem>
  ));
}
