import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    'getting-started',
    'usage',
    {
      type: 'category',
      label: 'Guides',
      collapsed: false,
      items: [
        'currency',
        'fit-to-width',
        'loading',
        'reveal',
        'imperative',
        'accessibility',
      ],
    },
    'props',
    {
      type: 'category',
      label: 'Performance',
      collapsed: false,
      items: ['performance', 'benchmarks', 'comparison'],
    },
    'how-it-works',
    {
      type: 'category',
      label: 'More packages',
      collapsed: false,
      items: ['morph-input'],
    },
  ],
};

export default sidebars;
