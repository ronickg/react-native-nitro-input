import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

/**
 * Sidebar for the Rolling Number section (/rolling-number).
 *
 * Shaped like the other Nitro libraries' docs: Guides gets you running,
 * Concepts is the mental model, Topics is one page per thing the view does,
 * Reference is the generated-feeling prop list.
 */
const sidebars: SidebarsConfig = {
  docs: [
    {
      type: 'category',
      label: 'Guides',
      collapsed: false,
      items: ['getting-started', 'comparison'],
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
        'rolling-and-timing',
        'formatting',
        'typography-and-sizing',
        'currency',
        'fit-to-width',
        'loading',
        'reveal',
        'imperative',
        'accessibility',
        'performance',
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
