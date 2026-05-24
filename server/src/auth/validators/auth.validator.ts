const sexMap = new Map<string, SexInput>([
  ['female', 'FEMALE'],
  ['male', 'MALE'],
  ['non-binary', 'NON_BINARY'],
  ['non_binary', 'NON_BINARY'],
  ['prefer not to say', 'PREFER_NOT_TO_SAY'],
  ['prefer_not_to_say', 'PREFER_NOT_TO_SAY'],
]);

type SexInput = 'FEMALE' | 'MALE' | 'NON_BINARY' | 'PREFER_NOT_TO_SAY';

export type RegistrationInput = {
  phoneNumber: string;
  otp: string;
  fullName: string;
  age: number;
  college: string;
  sex: SexInput;
  history: string[];
};

export const normalizePhoneNumber = (value: unknown) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, '');

  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length > 0) return `+${digits}`;
  return '';
};

export const normalizeOtp = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

export const parseRegistrationInput = (body: Record<string, unknown>): RegistrationInput => {
  const phoneNumber = normalizePhoneNumber(body.phoneNumber);
  const otp = normalizeOtp(body.otp);
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const college = typeof body.college === 'string' ? body.college.trim() : '';
  const age = Number(body.age);
  const sexRaw = typeof body.sex === 'string' ? body.sex.trim().toLowerCase() : '';
  const sex = sexMap.get(sexRaw);
  const history = Array.isArray(body.history)
    ? body.history
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean)
    : [];

  if (!phoneNumber || phoneNumber.length < 11) {
    throw new Error('A valid phone number is required.');
  }
  if (!otp) {
    throw new Error('OTP is required.');
  }
  if (fullName.length < 2) {
    throw new Error('Full name is required.');
  }
  if (!Number.isInteger(age) || age < 13 || age > 120) {
    throw new Error('Age must be a valid number between 13 and 120.');
  }
  if (college.length < 2) {
    throw new Error('College is required.');
  }
  if (!sex) {
    throw new Error('Sex must be one of: Female, Male, Non-binary, Prefer not to say.');
  }

  return { phoneNumber, otp, fullName, age, college, sex, history };
};
