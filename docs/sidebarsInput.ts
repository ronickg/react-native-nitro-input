import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

/** Sidebar for the Nitro Input section (/input). */
const sidebars: SidebarsConfig = {
  input: [
    'index',
    'getting-started',
    {
      type: 'category',
      label: 'Guides',
      collapsed: false,
      items: ['amount-field', 'text', 'plain-field', 'worklets', 'react-native'],
    },
    'props',
    'benchmarks',
    'how-it-works',
  ],
};

export default sidebars;
