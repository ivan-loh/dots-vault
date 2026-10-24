const disclosure = 'Invented demonstration data; no real account or person.';
const fixtures = [
  {
    fixture_id: 'note-demo',
    kind: 'note',
    synthetic: true,
    disclosure,
    data: {
      title: 'Fictional POC note',
      body: 'DOTS_VAULT_POC_NOTE_V1: The private connector can read this invented fixture. This is not your encrypted note.',
    },
  },
  {
    fixture_id: 'contact-demo',
    kind: 'contact',
    synthetic: true,
    disclosure,
    data: {
      name: 'Fictional Example Person',
      organization: 'Imaginary POC Organization',
      emails: ['person@example.invalid'],
      phones: ['NOT_A_PHONE_NUMBER'],
      addresses: ['FICTIONAL ADDRESS - NOT A REAL LOCATION'],
      notes: 'DOTS_VAULT_POC_CONTACT_V1',
    },
  },
  {
    fixture_id: 'credential-demo',
    kind: 'dummy-credential',
    synthetic: true,
    disclosure,
    data: {
      website: 'https://example.invalid/dots-vault-poc',
      username: 'DEMO_ONLY_NOT_A_REAL_ACCOUNT',
      password: 'NONFUNCTIONAL_DEMO_VALUE_DO_NOT_USE',
      note: 'DOTS_VAULT_POC_CREDENTIAL_V1: This value works on no real service.',
    },
  },
];
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
freeze(fixtures);
export function listFixtures() {
  return {
    synthetic: true,
    disclosure,
    fixtures: fixtures.map(({ fixture_id, kind }) => ({ fixture_id, kind, synthetic: true })),
  };
}
export function readFixture(id) {
  const record = fixtures.find((item) => item.fixture_id === id);
  return record ? structuredClone(record) : null;
}
