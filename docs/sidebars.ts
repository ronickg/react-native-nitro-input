import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

/** The one sidebar: the two components, NumberFormat, their references and the benchmarks. */
const sidebars: SidebarsConfig = {
  docs: [
    'getting-started',
    {
      type: 'category',
      label: 'NitroInput',
      collapsed: false,
      items: ['nitro-input', 'reflow', 'worklets'],
    },
    {
      type: 'category',
      label: 'NitroNumber',
      collapsed: false,
      items: ['nitro-number', 'formatting', 'loading-and-reveal'],
    },
    'number-format',
    {
      type: 'category',
      label: 'Reference',
      collapsed: false,
      items: ['nitro-input-props', 'nitro-number-props'],
    },
    'benchmarks',
  ],
};

export default sidebars;
