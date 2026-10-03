// Centers every display unit on the fixation line.
export default {
  name: 'Zentriert',
  description: 'Die optische Mitte jeder Einheit liegt auf der Fixationslinie.',
  hooks: {
    layout: () => ({ ratio: 0.5, origin: 0.5 }),
  },
};
