// Unit and accessibility tests for semantic Product Shelf component
// Exports test suite for Shelf.tsx
// Depends on vitest, @testing-library/react, axe-core, ./Shelf, ../types

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import axe from 'axe-core';
import Shelf from './Shelf';
import { ShelfProduct } from '../types';

const mockShelfProducts: ShelfProduct[] = [
  {
    id: 'p_001',
    title: 'UltraCushion Pro Runner',
    price_inr: 3499,
    pan: -1.0,
    alt_text: 'Black running shoe with responsive white foam cushioning',
  },
  {
    id: 'p_002',
    title: 'AeroGrip Trail Walker',
    price_inr: 2799,
    pan: 0.0,
    alt_text: 'Navy blue trail shoe with high-traction rubber lugs',
  },
  {
    id: 'p_003',
    title: 'Slip-On Ortho Comfort',
    price_inr: 2199,
    pan: 1.0,
    alt_text: 'Grey slip-on sneaker with memory foam insole',
  },
];

describe('M2-10 Accessible Product Shelf Tests', () => {
  it('passes axe accessibility audit with zero violations', async () => {
    const { container } = render(
      <main>
        <Shelf products={mockShelfProducts} />
      </main>
    );

    const results = await axe.run(container, {
      rules: {
        // Color contrast in jsdom can be checked or exempted if computed styles are empty
        'color-contrast': { enabled: false },
      },
    });

    expect(results.violations).toEqual([]);
  });

  it('renders semantic ordered list and proper heading hierarchy', () => {
    render(<Shelf products={mockShelfProducts} />);

    // Main shelf heading is h2
    const shelfHeading = screen.getByRole('heading', { level: 2, name: /curated product shelf/i });
    expect(shelfHeading).toBeDefined();

    // Semantic list
    const list = screen.getByRole('list', { name: /top 3 recommended products/i });
    expect(list).toBeDefined();
    expect(list.tagName).toBe('OL');

    // Each product has an h3 heading
    const productHeadings = screen.getAllByRole('heading', { level: 3 });
    expect(productHeadings.length).toBe(3);
    expect(productHeadings[0].textContent).toContain('UltraCushion Pro Runner');
  });

  it('provides accessible buttons with >= 48px touch targets and descriptive labels', () => {
    render(<Shelf products={mockShelfProducts} />);

    // Buttons have descriptive accessible names
    const detailsButtons = screen.getAllByRole('button', { name: /hear detailed specs for/i });
    expect(detailsButtons.length).toBe(3);

    const cartButtons = screen.getAllByRole('button', { name: /add .* to cart for ₹/i });
    expect(cartButtons.length).toBe(3);

    // Touch targets meet >= 48px requirement
    detailsButtons.forEach((btn) => {
      expect(btn.className).toContain('min-h-[48px]');
    });

    cartButtons.forEach((btn) => {
      expect(btn.className).toContain('min-h-[48px]');
    });
  });

  it('announces product shelf updates via callback without duplicate announcements', () => {
    const announceSpy = vi.fn();
    const { rerender } = render(
      <Shelf products={mockShelfProducts} onAnnounce={announceSpy} />
    );

    expect(announceSpy).toHaveBeenCalledTimes(1);
    expect(announceSpy).toHaveBeenCalledWith(
      expect.stringContaining('Found 3 products')
    );

    // Re-rendering with identical products should NOT announce again
    rerender(<Shelf products={mockShelfProducts} onAnnounce={announceSpy} />);
    expect(announceSpy).toHaveBeenCalledTimes(1);
  });

  it('triggers select and add-to-cart action callbacks when clicked', () => {
    const selectSpy = vi.fn();
    const cartSpy = vi.fn();

    render(
      <Shelf
        products={mockShelfProducts}
        onSelectProduct={selectSpy}
        onAddToCart={cartSpy}
      />
    );

    const firstDetailsBtn = screen.getByRole('button', {
      name: /hear detailed specs for UltraCushion Pro Runner/i,
    });
    fireEvent.click(firstDetailsBtn);
    expect(selectSpy).toHaveBeenCalledWith(mockShelfProducts[0]);

    const firstCartBtn = screen.getByRole('button', {
      name: /add UltraCushion Pro Runner to cart for ₹3499/i,
    });
    fireEvent.click(firstCartBtn);
    expect(cartSpy).toHaveBeenCalledWith(mockShelfProducts[0]);
  });
});
