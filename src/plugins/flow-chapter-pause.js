// Stops at the end of every chapter.
export default {
  name: 'Kapitelpause',
  description: 'Hält am Ende jedes Kapitels an.',
  hooks: {
    flow: (event) => (event.type === 'chapterEnd' ? [{ type: 'pause', message: 'Kapitel zu Ende' }] : []),
  },
};
