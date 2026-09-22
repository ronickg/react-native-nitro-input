import React from 'react';

/**
 * One prop of a component on a reference page: a header line with the name
 * (an anchor), its type, a platform badge and its default, then the
 * description at full width. Grouped under a heading per topic, this reads
 * better than a four-column table, whose description column is what gets
 * squeezed on a narrow screen, and every prop gets a link of its own.
 *
 * `name` may list several props (`"prefix, suffix"`) that share a description.
 * The completeness tests in the packages read `name="…"` off these blocks, so
 * the attribute stays a plain string.
 */
export interface PropProps {
  name: string;
  type?: string;
  default?: string;
  platform?: 'ios' | 'android';
  children?: React.ReactNode;
}

const PLATFORM_LABEL = {ios: 'iOS', android: 'Android'} as const;

/** A default that reads as code (a literal) rather than as prose ("platform tint"). */
const LITERAL = /^(['"[{\d-]|true$|false$|NaN$|null$|\d)/;

export default function Prop({name, type, default: fallback, platform, children}: PropProps) {
  const names = name
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  const id = `prop-${names[0]}`;
  return (
    <div className="prop" id={id}>
      <div className="prop-head">
        <a className="prop-name" href={`#${id}`}>
          {names.map((n, i) => (
            <React.Fragment key={n}>
              {i > 0 ? ', ' : null}
              <code>{n}</code>
            </React.Fragment>
          ))}
        </a>
        {type != null ? <code className="prop-type">{type}</code> : null}
        {platform != null ? <span className="prop-badge">{PLATFORM_LABEL[platform]}</span> : null}
        {fallback != null ? (
          <span className="prop-default">
            Default {LITERAL.test(fallback) ? <code>{fallback}</code> : <span>{fallback}</span>}
          </span>
        ) : null}
      </div>
      <div className="prop-body">{children}</div>
    </div>
  );
}
