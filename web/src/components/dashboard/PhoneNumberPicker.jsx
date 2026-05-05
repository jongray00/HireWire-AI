import { useEffect, useRef, useState } from 'react';

/**
 * @param {Object} props
 * @param {string} props.value - currently selected phone number (E.164 or empty)
 * @param {(val: string) => void} props.onChange
 * @param {string} props.label
 * @param {string} [props.placeholder]
 * @param {{ spaceUrl: string, projectId: string, apiToken: string }} props.credentials
 * @param {"all" | "campaign-registry"} [props.source]
 *   "all" (default) — list every IncomingPhoneNumber on the project. Renders
 *   as a select with a "Custom number…" toggle.
 *   "campaign-registry" — list only numbers assigned to a TCR / 10DLC
 *   campaign. Renders as a single text input with an embedded caret button
 *   that opens a popover of registry numbers. Typing any number is always
 *   permitted.
 * @param {"select" | "combobox"} [props.variant]
 *   "select" (default for `source="all"`) — flat dropdown with a "Custom number…" toggle.
 *   "combobox" — single text input + caret button that opens a popover of pickable numbers.
 *   `source="campaign-registry"` always uses the combobox renderer regardless of this prop.
 */
export default function PhoneNumberPicker({
  value,
  onChange,
  label,
  placeholder,
  credentials,
  source = 'all',
  variant = 'select',
}) {
  const [phoneNumbers, setPhoneNumbers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [useCustom, setUseCustom] = useState(false);

  useEffect(() => {
    if (!credentials?.spaceUrl || !credentials?.projectId || !credentials?.apiToken) return;

    const endpoint =
      source === 'campaign-registry'
        ? '/api/signalwire/campaign-registry-numbers'
        : '/api/signalwire/phone-numbers';
    const qs = new URLSearchParams({
      spaceUrl: credentials.spaceUrl,
      projectId: credentials.projectId,
      apiToken: credentials.apiToken,
    });

    setLoading(true);
    fetch(`${endpoint}?${qs.toString()}`)
      .then(r => r.json())
      .then(data => {
        if (data.success) setPhoneNumbers(data.phoneNumbers || []);
      })
      .catch(err => console.error('Failed to load phone numbers:', err))
      .finally(() => setLoading(false));
  }, [credentials?.spaceUrl, credentials?.projectId, credentials?.apiToken, source]);

  const formatNumber = (num) => {
    if (!num) return '';
    const cleaned = num.replace(/\D/g, '');
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }
    return num;
  };

  const fieldClasses =
    "w-full px-4 py-3 text-sm bg-[#0A0A0A] border border-[#1F1F1F] " +
    "text-[#FAFAFA] placeholder:text-[#737373] " +
    "focus:outline-none focus:ring-2 focus:ring-[#2553F4] focus:border-[#2553F4] transition-colors";

  const useCombobox = source === 'campaign-registry' || variant === 'combobox';

  if (useCombobox) {
    return (
      <ComboboxField
        value={value || ''}
        onChange={onChange}
        label={label}
        placeholder={placeholder || '+15551234567'}
        loading={loading}
        options={phoneNumbers}
        formatNumber={formatNumber}
      />
    );
  }

  // Default UI ("all" source): select with a "Custom number…" toggle.
  const isKnownNumber = phoneNumbers.some(p => p.phoneNumber === value);
  const showCustomInput = useCustom || (value && !isKnownNumber && phoneNumbers.length > 0);

  return (
    <div>
      <label className="block text-sm font-medium text-[#A3A3A3] mb-2">
        {label}
      </label>

      {loading ? (
        <p className="text-sm text-[#737373]">Loading phone numbers...</p>
      ) : (
        <>
          <select
            value={showCustomInput ? '__custom__' : (value || '')}
            onChange={(e) => {
              if (e.target.value === '__custom__') {
                setUseCustom(true);
              } else {
                setUseCustom(false);
                onChange(e.target.value);
              }
            }}
            className={fieldClasses}
          >
            <option value="">— Select a number —</option>
            {phoneNumbers.map((pn) => (
              <option key={pn.sid || pn.phoneNumber} value={pn.phoneNumber}>
                {formatNumber(pn.phoneNumber)}{pn.friendlyName ? ` — "${pn.friendlyName}"` : ''}
              </option>
            ))}
            <option value="__custom__">Custom number...</option>
          </select>

          {showCustomInput && (
            <input
              type="text"
              value={value || ''}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder || '+15551234567'}
              className={`${fieldClasses} mt-2`}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Combobox: a single text input with a caret button that toggles a popover
 * listing pickable values. Typing in the input is always allowed; clicking a
 * popover row replaces the input value.
 */
function ComboboxField({ value, onChange, label, placeholder, loading, options, formatNumber }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const inputId = useRef(`phone-combobox-${Math.random().toString(36).slice(2)}`).current;

  // Close on click outside.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const inputClasses =
    "w-full pl-4 pr-10 py-3 text-sm bg-[#0A0A0A] border border-[#1F1F1F] " +
    "text-[#FAFAFA] placeholder:text-[#737373] " +
    "focus:outline-none focus:ring-2 focus:ring-[#2553F4] focus:border-[#2553F4] transition-colors";

  const hasOptions = options.length > 0;
  const caretDisabled = loading || !hasOptions;

  return (
    <div>
      <label
        htmlFor={inputId}
        className="block text-sm font-medium text-[#A3A3A3] mb-2"
      >
        {label}
      </label>
      <div ref={wrapperRef} className="relative">
        <input
          id={inputId}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            if (!caretDisabled) setOpen(true);
          }}
          onClick={() => {
            if (!caretDisabled) setOpen(true);
          }}
          placeholder={placeholder}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={inputClasses}
        />
        <button
          type="button"
          onClick={() => !caretDisabled && setOpen((o) => !o)}
          disabled={caretDisabled}
          aria-label="Open phone number list"
          aria-haspopup="listbox"
          aria-expanded={open}
          className={
            'absolute right-0 top-0 h-full px-3 flex items-center ' +
            'text-[#737373] hover:text-[#FAFAFA] ' +
            'focus:outline-none focus:text-[#2553F4] ' +
            'disabled:opacity-50 disabled:cursor-not-allowed'
          }
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {open && hasOptions && (
          <ul
            role="listbox"
            className={
              'absolute z-20 mt-1 w-full max-h-60 overflow-auto ' +
              'shadow-lg border border-[#1F1F1F] ' +
              'bg-[#0A0A0A] ' +
              'py-1 text-sm'
            }
          >
            {options.map((pn) => {
              const selected = pn.phoneNumber === value;
              return (
                <li
                  key={pn.sid || pn.phoneNumber}
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(pn.phoneNumber);
                    setOpen(false);
                  }}
                  className={
                    'cursor-pointer px-4 py-2 ' +
                    'text-[#FAFAFA] ' +
                    'hover:bg-[#1F1F1F] ' +
                    (selected ? 'bg-[#1F1F1F] font-medium' : '')
                  }
                >
                  <div>{formatNumber(pn.phoneNumber)}</div>
                  {pn.friendlyName && (
                    <div className="text-xs text-[#737373]">
                      {pn.friendlyName}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
