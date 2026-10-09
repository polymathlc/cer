// Shared deterministic source material for the real summary-sheet modules.
// URLs are routed locally by browser QA; no source, AI or storage network calls.
export const fixtureImage = name => 'https://summary-sheet.test/images/' + name + '.svg';
export function sampleQuestions() {
  return [
    {
      id: 'heat-1', title: 'Cooling hot water', topic: 'Heat', topic2: 'Matter', category: 'MCQ',
      tags: ['cooling', 'temperature'], createdAt: '2025-10-01', source: { paper: 'Heat investigations', pages: [2] },
      answerKeyNote: 'The temperature decreases because heat is transferred to the surroundings.',
      answerKeyImage: fixtureImage('key-only'),
      blocks: [
        { id: 'stem', type: 'text', content: '<p>Water cooled from 80°C to 50°C in 5 minutes. Why did it cool?</p><img src="' + fixtureImage('apparatus') + '" alt="Cup and thermometer">', marks: 2 },
        { id: 'figure', type: 'image', url: fixtureImage('apparatus'), caption: 'Cup A', answerImg: fixtureImage('annotated-answer') },
        { id: 'table', type: 'table', data: { 0: { 0: 'Time / min', 1: 'Temperature / °C' }, 1: { 0: '0', 1: '80' }, 2: { 0: '5', 1: '50 <img src="' + fixtureImage('table-figure') + '" alt="Temperature graph">' } } },
        { id: 'options', type: 'mcq', correctId: 'o1', options: [
          { id: 'o1', text: 'Heat moves to the surroundings. <img src="' + fixtureImage('option-a') + '" alt="Arrow outwards">' },
          { id: 'o2', text: 'Cold moves into the water. <img src="' + fixtureImage('option-b') + '" alt="Arrow inwards">' },
        ] },
        { id: 'answer', type: 'plainanswer', content: 'Water loses heat to its cooler surroundings.' },
        { id: 'explanation', type: 'explanation', content: 'Heat transfers from a hotter place to a cooler place.', url: fixtureImage('explanation-only') },
      ],
    },
    {
      id: 'heat-2', title: 'Comparing insulation', topic: 'Heat', category: 'CER', tags: ['insulation'],
      blocks: [
        { id: 'stem', type: 'text', content: '<p>Cup A is wrapped in felt. Cup B is uncovered. Both begin at 80°C. Which keeps the water hot longer?</p>' },
        { id: 'figure', type: 'image', url: fixtureImage('wide-insulation'), caption: 'Cups A and B' },
        { id: 'answer', type: 'answer', claim: 'Cup A keeps water hot longer.', evidence: 'It loses less heat in the same time.', reasoning: 'Felt is a poor conductor of heat.' },
      ],
    },
    {
      id: 'light-1', title: 'A shadow', topic: 'Light', category: 'Explanation',
      blocks: [
        { id: 'stem', type: 'text', content: '<p>Why does an opaque object form a shadow?</p>' },
        { id: 'figure', type: 'image', url: fixtureImage('tall-shadow'), caption: 'Torch, object and screen' },
        { id: 'answer', type: 'plainanswer', content: 'The opaque object blocks light from reaching the screen.' },
      ],
    },
  ];
}
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
export const teacher = () => ({ uid: 'teacher-1', name: 'Teacher', role: 'admin' });
export function sourceContext(question) {
  const contexts={
    'heat-1':{text:'Water cooled from 80°C to 50°C in 5 minutes. Why did it cool?\nTime / min | Temperature / °C\n0 | 80\n5 | 50\n(1) Heat moves to the surroundings.\n(2) Cold moves into the water.',answer:'Water loses heat to its cooler surroundings.',explanation:'Heat transfers from a hotter place to a cooler place.'},
    'heat-2':{text:'Cup A is wrapped in felt. Cup B is uncovered. Both begin at 80°C. Which keeps the water hot longer?',answer:'Cup A keeps water hot longer. It loses less heat in the same time. Felt is a poor conductor of heat.',explanation:'Insulation reduces the rate of heat transfer.'},
    'light-1':{text:'Why does an opaque object form a shadow?',answer:'The opaque object blocks light from reaching the screen.',explanation:'Light cannot pass through an opaque object.'},
  };
  return structuredClone(contexts[question.id] || {text:question.title,answer:'Review the source answer.',explanation:''});
}
