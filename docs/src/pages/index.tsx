import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import CodeBlock from '@theme/CodeBlock';
import HeroNumber from '@site/src/components/Hero/HeroNumber';
import Phones from '@site/src/components/Phones/Phones';

import styles from './index.module.css';

const USAGE = `import { RollingNumber } from 'react-native-nitro-rolling-number'

<RollingNumber
  value={balance}
  fractionDigits={2}
  groupingSeparator=","
  prefix="$"
  fontSize={48}
  fontWeight="800"
  easing="spring"
  stagger={30}
/>`;

const FEATURES: {title: string; body: ReactNode}[] = [
  {
    title: 'Native on both platforms',
    body: 'One C++ engine drives a CALayer renderer on iOS and a Canvas renderer on Android. The JS thread sends a value once; the roll never waits for it.',
  },
  {
    title: 'Every digit is a wheel',
    body: 'Digits roll the short way in the direction of the change, columns slide in and out as the number grows, with easing, spring or a cascading stagger.',
  },
  {
    title: 'Money-ready formatting',
    body: 'Fraction digits, grouping and decimal separators, a currency symbol or code at its own size pinned to the top or bottom of the digits, zero padding, negatives.',
  },
  {
    title: 'Fits the box it is given',
    body: 'Auto-sizes to its content, or shrinks continuously to fit a fixed width without ever squeezing digits that are still rolling.',
  },
  {
    title: 'Jackpot reveal',
    body: 'The casino win-meter rollup and the slot-reel reveal, with tiers that punch and hold, all native. Built for “you won” moments.',
  },
  {
    title: 'Loading, accessible, recyclable',
    body: 'A text-shaped shimmer while the value loads, VoiceOver and TalkBack read the formatted amount, Reduce Motion snaps, and Fabric can recycle it in long lists.',
  },
];

function Hero() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero', styles.hero)}>
      <div className="container">
        <span className={styles.eyebrow}>
          <strong>Nitro Modules</strong> · iOS &amp; Android · New architecture
        </span>
        <Heading as="h1" className={styles.title}>
          Numbers that roll,
          <br />
          fields that morph
        </Heading>
        <p className={styles.tagline}>{siteConfig.tagline}</p>
        <HeroNumber />
        <p className={styles.heroNote}>
          Live: the same C++ engine that runs on your phone, compiled to WebAssembly.
        </p>
        <div className={styles.buttons}>
          <Link className="button button--primary button--lg" to="/rolling-number/getting-started">
            Rolling Number →
          </Link>
          <Link className="button button--primary button--lg" to="/input">
            Text Input →
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout title="Native React Native components" description="Two native components for React Native, built with Nitro Modules: a rolling number (odometer / ticker) and a native text input with amount formatting, masking and a floating label done natively, and a morph you can turn on. One C++ engine each, iOS and Android.">
      <Hero />
      <main>
        <section className={styles.section}>
          <div className="container">
            <div className={styles.features}>
              {FEATURES.map((f) => (
                <div key={f.title} className={styles.feature}>
                  <Heading as="h3">{f.title}</Heading>
                  <p>{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>


        <section className={styles.section}>
          <div className="container">
            <span className={styles.kicker}>Two packages</span>
            <Heading as="h2" className={styles.sectionTitle}>
              Pick a package
            </Heading>
            <p className={styles.sectionLead}>
              Both are built on Nitro Modules, both share the same formatting model, and
              each has its own documentation.
            </p>
            <div className={styles.products}>
              <Link className={styles.product} to="/rolling-number/getting-started">
                <div className={styles.productName}>react-native-nitro-rolling-number</div>
                <Heading as="h3">Rolling Number</Heading>
                <p>
                  An odometer for React Native. Every digit is a wheel driven by one C++
                  engine, with currency layouts, shrink-to-fit, a loading shimmer and the
                  jackpot reveal.
                </p>
                <span className={styles.productLink}>Get started →</span>
              </Link>
              <Link className={styles.product} to="/input">
                <div className={styles.productName}>react-native-nitro-input</div>
                <Heading as="h3">Text Input</Heading>
                <p>
                  A native text input. The system keyboard and accessibility stay; amounts
                  are formatted and masks applied in C++ before a frame is drawn, the
                  floating label is native, and the morph is there when you turn it on.
                </p>
                <span className={styles.productLink}>Get started →</span>
              </Link>
            </div>
          </div>
        </section>

        <section className={clsx(styles.section, styles.alt)}>
          <div className="container">
            <span className={styles.kicker}>On device</span>
            <Heading as="h2" className={styles.sectionTitle}>
              Running on iOS and Android
            </Heading>
            <p className={styles.sectionLead}>
              The example app, recorded on an iPhone 13 Pro Max and a Pixel 10. Same JavaScript, same engine.
            </p>
            <Phones ios="/video/ios-rolling.mp4" android="/video/android-rolling.mp4" caption="A live market screen: fourteen coins with price and 24 h change, a handful of them ticking every 200 ms, and a total balance derived from the holdings. Around thirty rolling numbers on screen, every one of them native." />
          </div>
        </section>

        <section className={styles.section}>
          <div className="container">
            <div className={styles.split}>
              <div>
                <Heading as="h2">One prop, one JSI call</Heading>
                <p className={styles.muted}>
                  Change <code>value</code> and the digits roll. The value crosses the bridge once as a plain number; everything from there is native, so a busy JS thread never delays the animation in flight, the shimmer or the shrink-to-fit scaling.
                </p>
                <p className={styles.muted}>
                  Need to drive it every frame? <code>jumpTo</code> positions the wheels continuously and coalesces to the newest value per frame.
                </p>
              </div>
              <CodeBlock language="tsx">{USAGE}</CodeBlock>
            </div>
          </div>
        </section>

        <section className={clsx(styles.section, styles.alt)}>
          <div className="container">
            <span className={styles.kicker}>Reveal</span>
            <Heading as="h2" className={styles.sectionTitle}>
              The jackpot reveal
            </Heading>
            <p className={styles.sectionLead}>
              The casino win presentation: a count that opens at zero and rolls itself up tier by tier, or reels that spin and lock from the left, landing with a pop. All native.
            </p>
            <Phones ios="/video/ios-reveal.mp4" android="/video/android-reveal.mp4" caption="The count and spin styles on both platforms." />
          </div>
        </section>

        <section className={styles.section}>
          <div className="container">
            <span className={styles.kicker}>react-native-nitro-input</span>
            <Heading as="h2" className={styles.sectionTitle}>
              A native field, formatted before it draws
            </Heading>
            <p className={styles.sectionLead}>
              The second package: a native single-line input. The amount is formatted in C++ before the field shows a frame — grouping, decimals, caret and all — so a digit you type and the comma it displaces move in the same frame, with no JavaScript in between.
            </p>
            <Phones ios="/video/ios-input.mp4" android="/video/android-input.mp4" caption="Typing, backspacing, a value set from code, and a figure replaced wholesale. The same engine on both platforms." />
            <p className={clsx(styles.center, styles.muted)}>
              <Link to="/input">Read the Text Input docs →</Link>
            </p>
          </div>
        </section>

        <section className={clsx(styles.section, styles.alt)}>
          <div className="container">
            <span className={styles.kicker}>Benchmarks</span>
            <Heading as="h2" className={styles.sectionTitle}>
              Twenty-four numbers, every frame, still 60 fps
            </Heading>
            <p className={styles.sectionLead}>
              Release builds, 24 copies fed a new value on every frame. UI-thread frame rate from a Reanimated frame callback.
            </p>
            <div className={styles.benchGrid}>
              <Bench name="Nitro Rolling Number" ios="120 fps" android="60 fps" note="0 dropped frames on both" highlight />
              <Bench name="NumberFlow (View)" ios="35 fps" android="33 fps" note="JS thread at 2–6 fps" />
              <Bench name="NumberFlow (Skia)" ios="95 fps" android="59 fps" note="JS thread at 1–28 fps" />
              <Bench name="AnimatedNumbers" ios="114 fps" android="56 fps" note="JS thread at 12–14 fps" />
            </div>
            <p className={clsx(styles.center, styles.muted)}>
              iPhone 13 Pro Max (120 Hz) and Pixel 10. <Link to="/rolling-number/benchmarks">Method and full tables</Link>.
            </p>
          </div>
        </section>
      </main>
    </Layout>
  );
}

function Bench({name, ios, android, note, highlight}: {name: string; ios: string; android: string; note: string; highlight?: boolean}) {
  return (
    <div className={clsx(styles.bench, highlight && styles.benchHighlight)}>
      <div className={styles.benchName}>{name}</div>
      <div className={styles.benchNumbers}>
        <span>
          <small>iOS</small> {ios}
        </span>
        <span>
          <small>Android</small> {android}
        </span>
      </div>
      <div className={styles.benchNote}>{note}</div>
    </div>
  );
}
