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
    name: 'NitroNumber',
    to: '/docs/nitro-number',
    body: 'A number that animates its changes: every digit a wheel, or SwiftUI’s numeric transition, with currency layouts and currency switches that play, shrink-to-fit, a loading shimmer and the jackpot reveal.',
  },
];

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout title="A native text input and an animated number" description={siteConfig.tagline}>
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
              On a budget phone
            </Heading>
            <p className={styles.sectionLead}>
              The example app on a Samsung Galaxy A22 (MediaTek Helio G80, 90 Hz), recorded with the phone&apos;s own
              screen recorder, which takes a share of its GPU while it runs. iOS runs the same JavaScript on the same
              engines. The <Link to="/docs/benchmarks">benchmarks</Link> measure it against the other libraries.
            </p>
            <Phones
              videos={[
                {src: '/video/market.mp4', label: 'Market'},
                {src: '/video/transfer.mp4', label: 'Transfer'},
                {src: '/video/reveal.mp4', label: 'Jackpot'},
              ]}
              caption="A trading dashboard with 48 NitroNumbers and about 210 updates a second, no re-renders; a transfer whose amount reflows as it is typed and whose payout switches currency as one change; a jackpot counted up tier by tier."
            />
          </div>
        </section>
      </main>
    </Layout>
  );
}
