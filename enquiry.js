import { eligibleSubjects, validateEnquiry, createSubmissionTracker, sendEnquiry } from './enquiry-core.mjs';

const form = document.getElementById('enquiryForm');
const fields = document.getElementById('enquiryFields');
const status = document.getElementById('enquiryStatus');
const button = document.getElementById('submitEnquiry');
const label = document.getElementById('submitLabel');
const spinner = document.getElementById('submitSpinner');
const arrow = document.getElementById('submitArrow');
const success = document.getElementById('enquirySuccess');
const level = document.getElementById('childLevel');
const science = document.getElementById('subjectScience');
const math = document.getElementById('subjectMath');
const tracker = createSubmissionTracker();
let pending = false;

function syncSubjects() {
  const allowed = eligibleSubjects(level.value);
  for (const checkbox of [science, math]) {
    checkbox.disabled = !allowed.includes(checkbox.value);
    if (checkbox.disabled) checkbox.checked = false;
  }
  document.getElementById('subjectGuidance').textContent = !allowed.length
    ? 'Choose your child’s level to see the available subjects.'
    : !allowed.includes('math')
      ? 'Science is available at this level. Mathematics classes are offered from Primary 4 to Primary 6.'
      : 'Science and Mathematics are both available at this level. Choose one or both.';
}

function clearErrors() {
  form.querySelectorAll('.field-error').forEach(node => { node.hidden = true; node.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach(node => node.removeAttribute('aria-invalid'));
}

function showStatus(message, state = 'error') {
  status.textContent = message;
  status.dataset.state = state;
  status.hidden = false;
}

function setPending(value) {
  pending = value;
  button.disabled = value;
  fields.disabled = value;
  form.setAttribute('aria-busy', String(value));
  label.textContent = value ? 'Sending your enquiry…' : 'Send enquiry';
  spinner.hidden = !value;
  arrow.hidden = value;
  if (!value) syncSubjects();
}

function readForm() {
  return {
    parentName: document.getElementById('parentName').value,
    email: document.getElementById('email').value,
    phone: document.getElementById('phone').value,
    childLevel: level.value,
    subjects: [science, math].filter(input => input.checked).map(input => input.value),
    message: document.getElementById('message').value
  };
}

level.addEventListener('change', syncSubjects);
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (pending) return;
  clearErrors();
  const result = validateEnquiry(readForm());
  if (!result.valid) {
    for (const [field, message] of Object.entries(result.errors)) {
      const error = document.getElementById(field + 'Error');
      if (error) { error.textContent = message; error.hidden = false; }
      const input = document.getElementById(field);
      if (input) input.setAttribute('aria-invalid', 'true');
      if (field === 'subjects') [science, math].forEach(node => node.setAttribute('aria-invalid', 'true'));
    }
    showStatus('Please check the highlighted details before sending your enquiry.');
    const first = Object.keys(result.errors)[0];
    const focus = first === 'subjects' ? [science, math].find(node => !node.disabled) : document.getElementById(first);
    (focus || status).focus();
    return;
  }
  const payload = { submissionId: tracker.forPayload(result.data), ...result.data };
  setPending(true);
  showStatus('Sending your enquiry. Please keep this page open for confirmation.', 'pending');
  try {
    await sendEnquiry(payload);
    tracker.accepted(result.data);
    form.reset();
    clearErrors();
    status.hidden = true;
    form.hidden = true;
    success.hidden = false;
    success.focus();
  } catch (error) {
    const messages = {
      'rate-limit': 'We’re receiving several enquiries right now. Please wait a little, then try again. Your details are still here.',
      unavailable: 'We couldn’t send your enquiry right now. Please try again in a little while. Your details are still here.',
      validation: 'We couldn’t accept those details. Please check your email, contact number, child’s level, and subjects, then try again.',
      timeout: 'We haven’t received confirmation yet. Your enquiry may have reached us. Please try again using the same details; we’ll use the same enquiry reference to avoid sending it twice.',
      network: 'We couldn’t confirm your enquiry. Check your connection and try again. Your details are still here, and retrying will use the same enquiry reference.',
      unknown: 'We couldn’t confirm that your enquiry was received. Please try again. Your details are still here, and retrying will use the same enquiry reference.'
    };
    showStatus(messages[error?.kind] || messages.unknown);
    status.focus();
  } finally { setPending(false); }
});

document.getElementById('anotherEnquiry').addEventListener('click', () => {
  success.hidden = true;
  form.hidden = false;
  status.hidden = true;
  syncSubjects();
  document.getElementById('email').focus();
});
syncSubjects();
button.disabled = false;
