import type { Preview } from '@storybook/nextjs-vite'

import '@/app/globals.css'

const preview: Preview = {
  parameters: {
    layout: 'centered',
    viewport: {
      defaultViewport: 'mobile1',
    },
    backgrounds: {
      default: 'jaroo-gray',
      values: [
        { name: 'jaroo-gray', value: '#f7f8fa' },
        { name: 'jaroo-dark', value: '#0b0e13' },
      ],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
}

export default preview
