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

const INSTALL = `bun add react-native-nitro-input react-native-nitro-modules`;

const COMPONENTS: {name: string; to: string; body: string}[] = [
  {
    name: 'NitroInput',
    to: '/docs/nitro-input',
    body: 'A native text input. The system keyboard, selection and accessibility stay; amounts are formatted and masks applied in C++ before a frame is drawn, the outlined frame and its floating label are native, and the characters can reflow as they change.',
  },
  {
    name: 'RollingNumber',
    to: '/docs/rolling-number',
    body: 'A number that animates its changes: every digit a wheel, or SwiftUI’s numeric transition, with currency layouts, shrink-to-fit, a loading shimmer and the jackpot reveal.',
  },
];

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout title="A native text input and a rolling number" description={siteConfig.tagline}>
      <header className={clsx('hero', styles.hero)}>
        <div className="container">
          <span className={styles.eyebrow}>
            <strong>Nitro Modules</strong> · iOS &amp; Android · New architecture
          </span>
          <Heading as="h1" className={styles.title}>
            Numbers that roll,
            <br />
            fields that reflow
          </Heading>
          <p className={styles.tagline}>{siteConfig.tagline}</p>
          <HeroNumber />
          <p className={styles.heroNote}>Live: the same C++ engine that runs on your phone, compiled to WebAssembly.</p>
          <div className={styles.buttons}>
            <Link className="button button--primary button--lg" to="/docs">
              Get started →
            </Link>
          </div>
        </div>
      </header>
      <main>
        <section className={styles.section}>
          <div className="container">
            <div className={styles.products}>
              {COMPONENTS.map((c) => (
                <Link key={c.name} className={styles.product} to={c.to}>
                  <Heading as="h3">{c.name}</Heading>
                  <p>{c.body}</p>
                  <span className={styles.productLink}>Read the docs →</span>
                </Link>
              ))}
            </div>
            <CodeBlock language="bash">{INSTALL}</CodeBlock>
          </div>
        </section>

        <section className={clsx(styles.section, styles.alt)}>
          <div className="container">
            <Heading as="h2" className={styles.sectionTitle}>
              On iOS and Android
            </Heading>
            <p className={styles.sectionLead}>
              The example app on an iPhone 13 Pro Max and a Pixel 10: the same JavaScript and the same engines. The{' '}
              <Link to="/docs/benchmarks">benchmarks</Link> measure it against the other libraries.
            </p>
            <Phones ios="/video/ios-rolling.mp4" android="/video/android-rolling.mp4" caption="A live market screen: around thirty rolling numbers, a handful ticking every 200 ms." />
            <Phones ios="/video/ios-input.mp4" android="/video/android-input.mp4" caption="An amount typed, backspaced and set from code, reflowing into place." />
          </div>
        </section>
      </main>
    </Layout>
  );
}
