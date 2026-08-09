import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UcmLogo, type UcmLogoSize } from './Logo';

describe('UcmLogo', () => {
  it.each<[UcmLogoSize, number]>([
    ['inline', 32],
    ['sidebar', 40],
    ['staff-sign-in', 40],
    ['hero', 72],
    ['mobile-nav', 40],
  ])('renders the %s logo in a square %dpx box', (size, dimension) => {
    render(<UcmLogo size={size} />);

    const logo = screen.getByRole('img', { name: 'UCM Coffee logo' });
    expect(logo).toHaveAttribute('width', String(dimension));
    expect(logo).toHaveAttribute('height', String(dimension));
    expect(logo).toHaveClass(`ucm-logo--${size}`);
    expect(logo).toHaveAttribute('src', expect.stringContaining('.png'));
  });
});
