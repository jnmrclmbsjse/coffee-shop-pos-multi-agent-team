import logoUrl from './assets/ucm-coffee-logo.png';

const LOGO_DIMENSIONS = {
  hero: 72,
  inline: 32,
  'mobile-nav': 40,
  sidebar: 40,
  'staff-sign-in': 40,
} as const;

export type UcmLogoSize = keyof typeof LOGO_DIMENSIONS;

export function UcmLogo({ size }: { size: UcmLogoSize }) {
  const dimension = LOGO_DIMENSIONS[size];

  return (
    <img
      alt="UCM Coffee logo"
      className={`ucm-logo ucm-logo--${size}`}
      height={dimension}
      src={logoUrl}
      width={dimension}
    />
  );
}
