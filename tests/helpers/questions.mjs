import {randomUUID} from 'node:crypto';

const reviewers = new WeakMap();
// These survey fixtures deliberately exercise approval before generation.
export async function approvedQuestion(request, root, owner, payload, password) {
  let reviewer = reviewers.get(request);
  if (!reviewer) {
    reviewer = {email: `question-hr-${randomUUID()}@example.test`, roots: new Set()};
    reviewers.set(request, reviewer);
  }
  if (!reviewer.roots.has(root)) {
    const invitation = await request('POST', `${root}/invitations`, owner, {email: reviewer.email, role: 'HR_ADMIN'}, 201);
    if (!reviewer.token) {
      await request('POST', '/invitations/accept', null, {token: invitation.token, displayName: 'Question reviewer', password}, 201);
      reviewer.token = (await request('POST', '/auth/login', null, {email: reviewer.email, password})).token;
    } else {
      await request('POST', '/invitations/accept', reviewer.token, {token: invitation.token}, 201);
    }
    reviewer.roots.add(root);
  }
  if (payload.dimension === undefined && !payload.skillWeights?.length) {
    const skills = await request('GET', `${root}/skills`, owner);
    const skill = skills.find(s => s.name === 'Fixture skill') ?? await request('POST', `${root}/skills`, owner, {name: 'Fixture skill'}, 201);
    payload = {...payload, skillWeights: [{skillId: skill.id, weight: 1}]};
  }
  const draft = await request('POST', `${root}/questions`, owner, payload, 201);
  return request('POST', `${root}/questions/${draft.id}/review`, reviewer.token, {decision: 'APPROVED'});
}

export async function fiveQuestions(request, root, owner, preferred = []) {
  const reviewer = reviewers.get(request);
  if (!reviewer?.roots.has(root)) throw new Error('Create an approved fixture question before selecting the five-question survey');
  await request('POST', `${root}/questions/import-standard`, reviewer.token, {});
  const questions = await request('GET', `${root}/questions`, owner);
  const skillIds = [...preferred.map(q => q.id), ...questions.filter(q => q.dimension === 'SKILL' && q.standardTemplateKey).map(q => q.id)].slice(0, 3);
  const chemistry = ['CHEMISTRY_ENJOYMENT', 'CHEMISTRY_EFFECTIVENESS'].map(d => questions.find(q => q.dimension === d && q.standardTemplateKey).id);
  return [...skillIds, ...chemistry];
}

export function ratingAnswers(ids, rating = 4) {
  return {answers: ids.map(questionVersionId => ({questionVersionId, rating}))};
}
