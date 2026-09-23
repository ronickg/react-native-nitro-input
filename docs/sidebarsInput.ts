import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

/** Sidebar for the Nitro Input section (/input). Same shape as the other one. */
const sidebars: SidebarsConfig = {
  input: [
    {
      type: 'category',
      label: 'Guides',
      collapsed: false,
      items: ['getting-started', 'playground'],
    },
    {
      type: 'category',
      label: 'The field',
      collapsed: false,
      items: ['amount-field', 'masked-field', 'frames', 'multiline'],
    },
    {
      type: 'category',
      label: 'Opt-in effects',
      collapsed: false,
      items: ['reflow', 'how-it-works'],
    },
    {
      type: 'category',
      label: 'Integration',
      collapsed: false,
      items: ['worklets', 'react-native', 'benchmarks'],
    },
    {
      type: 'category',
      label: 'Reference',
      collapsed: false,
      items: ['props'],
    },
  ],
};

export default sidebars;
