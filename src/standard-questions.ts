// Version these keys when wording or mappings change. Existing company imports
// keep their original wording, review, and skill links.
export const STANDARD_LIBRARY_VERSION = '2';
export const STANDARD_SKILLS = [
  {key: 'technical-problem-solving', name: 'Technical Problem Solving', questions: [
    'How effectively did this colleague identify the cause of technical problems?',
    'How effectively did this colleague apply technical knowledge to find practical solutions?',
    'How thoroughly did this colleague check that their solution worked?',
  ]},
  {key: 'communication', name: 'Communication', questions: [
    'How clearly did this colleague explain information you needed for your work?',
    'How promptly did this colleague communicate changes or problems affecting your tasks?',
    'How well did this colleague listen and check their understanding during discussions?',
  ]},
  {key: 'teamwork', name: 'Teamwork', questions: [
    'How effectively did this colleague coordinate their work with yours?',
    'How constructively did this colleague handle differences of opinion?',
    'How willing was this colleague to provide support when you needed it?',
  ]},
  {key: 'leadership', name: 'Leadership', questions: [
    'How clearly did this colleague explain priorities when guiding shared work?',
    'How effectively did this colleague help the group move forward when work became blocked?',
    'How well did this colleague consider others’ input when making decisions affecting the group?',
  ]},
  {key: 'reliability', name: 'Reliability', questions: [
    'How consistently did this colleague follow through on agreed commitments?',
    'How early did this colleague raise concerns about commitments they might not meet?',
    'How consistently did this colleague complete agreed checks before handing over work?',
  ]},
] as const;

const SKILL_QUESTIONS = STANDARD_SKILLS.flatMap(skill => skill.questions.map((text, index) => ({
  templateKey: `standard-v1:${skill.key}:${index + 1}`,
  questionKey: `standard:${skill.key}:${index + 1}`,
  text,
  dimension: 'SKILL' as const,
  skillName: skill.name,
  skillWeights: [{skillName: skill.name, weight: 1}],
})));

export const STANDARD_CHEMISTRY = [
  {key: 'enjoyment', dimension: 'CHEMISTRY_ENJOYMENT', questions: [
    'How comfortable did you feel working with this colleague?',
    'How positive was your experience of working with this colleague?',
    'How willing would you be to work closely with this colleague again?',
  ]},
  {key: 'effectiveness', dimension: 'CHEMISTRY_EFFECTIVENESS', questions: [
    'How effectively did you and this colleague work together to complete shared tasks?',
    'How well did you and this colleague coordinate your work?',
    'How effectively did you and this colleague resolve difficulties together?',
  ]},
] as const;

const CHEMISTRY_QUESTIONS = STANDARD_CHEMISTRY.flatMap(group => group.questions.map((text, index) => ({
  templateKey: `standard-v2:chemistry-${group.key}:${index + 1}`,
  questionKey: `standard:chemistry-${group.key}:${index + 1}`,
  text,
  dimension: group.dimension,
  skillName: null,
  skillWeights: [],
})));

export const STANDARD_QUESTIONS = [...SKILL_QUESTIONS, ...CHEMISTRY_QUESTIONS];
