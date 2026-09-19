import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

/** Sidebar for the Nitro Input section (/input). Same shape as the other one. */
const sidebars: SidebarsConfig = {
  input: [
    {
      type: 'category',
      label: 'Guides',
      collapsed: false,
      items: ['getting-started'],
    },
    {
      type: 'category',
      label: 'Concepts',
      collapsed: false,
      items: ['how-it-works'],
    },
    {
      type: 'category',
      label: 'Topics',
      collapsed: false,
      items: [
        'amount-field',
        'text',
        'plain-field',
        'worklets',
        'react-native',
        'benchmarks',
      ],
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
