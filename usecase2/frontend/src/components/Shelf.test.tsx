// Unit and accessibility tests for semantic Product Shelf component and WCAG 2.5.7 non-draggable price filter
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

describe('M2-10 & M2-12 Accessible Product Shelf & Voice Price Filter Tests', () => {
  it('passes axe accessibility audit with zero violations', async () => {
    const { container } = render(
      <main>
        <Shelf products={mockShelfProducts} />
      </main>
    );

    const results = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: false },
      },
    });

    expect(results.violations).toEqual([]);
  });

  it('guarantees NO dragging or range slider interaction per WCAG 2.5.7', () => {
    const { container } = render(<Shelf products={mockShelfProducts} />);

    // Assert that no range inputs (sliders) exist in the component DOM
    const rangeSliders = container.querySelectorAll('input[type="range"]');
    expect(rangeSliders.length).toBe(0);

    // Assert that no elements have draggable attribute
    const draggables = container.querySelectorAll('[draggable="true"]');
    expect(draggables.length).toBe(0);
  });

  it('filters shelf products via large step buttons and announces aloud', () => {
    const announceSpy = vi.fn();
    render(<Shelf products={mockShelfProducts} onAnnounce={announceSpy} />);

    // Initially all 3 items displayed
    expect(screen.getByText(/3 of 3 items/i)).toBeDefined();

    // Find stepper decrease button (- ₹500)
    const decreaseBtn = screen.getByRole('button', { name: /decrease price limit by 500 rupees/i });
    expect(decreaseBtn).toBeDefined();
    expect(decreaseBtn.className).toContain('min-h-[48px]');

    // Click decrease button to cap budget (max item 3499 rounded to 3500 - 500 = 3000)
    fireEvent.click(decreaseBtn);

    // Items <= 3000 are p_002 (2799) and p_003 (2199) -> 2 items match
    expect(screen.getByText(/2 of 3 items/i)).toBeDefined();
    expect(announceSpy).toHaveBeenCalledWith(
      expect.stringMatching(/under ₹3,000.*2 products match/i)
    );

    // Click decrease again (3000 - 500 = 2500) -> only p_003 (2199) matches
    fireEvent.click(decreaseBtn);
    expect(screen.getByText(/1 of 3 items/i)).toBeDefined();
    expect(announceSpy).toHaveBeenCalledWith(
      expect.stringMatching(/under ₹2,500.*1 product matches/i)
    );

    // Clear filter
    const clearBtn = screen.getByRole('button', { name: /clear active price filter/i });
    fireEvent.click(clearBtn);
    expect(screen.getByText(/3 of 3 items/i)).toBeDefined();
    expect(announceSpy).toHaveBeenCalledWith(
      expect.stringMatching(/price filter cleared/i)
    );
  });

  it('applies voice price filter query and announces matching items', () => {
    const announceSpy = vi.fn();
    const { rerender } = render(
      <Shelf products={mockShelfProducts} onAnnounce={announceSpy} />
    );

    // Simulate voice query "under 3000"
    rerender(
      <Shelf
        products={mockShelfProducts}
        voiceQuery="under 3000"
        onAnnounce={announceSpy}
      />
    );

    expect(screen.getByText(/2 of 3 items/i)).toBeDefined();
    expect(announceSpy).toHaveBeenCalledWith(
      expect.stringMatching(/voice filter applied.*under ₹3,000/i)
    );
  });

  it('handles "under fifteen thousand" spoken phrase query', () => {
    const announceSpy = vi.fn();
    render(
      <Shelf
        products={mockShelfProducts}
        voiceQuery="show me options under fifteen thousand"
        onAnnounce={announceSpy}
      />
    );

    // All 3 items are under 15,000
    expect(screen.getByText(/3 of 3 items/i)).toBeDefined();
    expect(announceSpy).toHaveBeenCalledWith(
      expect.stringMatching(/under ₹15,000/i)
    );
  });

  it('displays accessible empty state when no products match budget cap', () => {
    const announceSpy = vi.fn();
    render(
      <Shelf
        products={mockShelfProducts}
        voiceQuery="under 1000"
        onAnnounce={announceSpy}
      />
    );

    // All items are > 2000, so 0 items match
    expect(screen.getByText(/no products match under ₹1,000/i)).toBeDefined();
    expect(announceSpy).toHaveBeenCalledWith(
      expect.stringMatching(/no products found under ₹1,000/i)
    );

    // Click "Show All Products" reset button
    const showAllBtn = screen.getByRole('button', { name: /reset price filter/i });
    fireEvent.click(showAllBtn);
    expect(screen.getByText(/3 of 3 items/i)).toBeDefined();
  });

  it('renders semantic ordered list and proper heading hierarchy', () => {
    render(<Shelf products={mockShelfProducts} />);

    // Main shelf heading is h2
    const shelfHeading = screen.getByRole('heading', { level: 2, name: /curated product shelf/i });
    expect(shelfHeading).toBeDefined();

    // Semantic list
    const list = screen.getByRole('list', { name: /top recommended products/i });
    expect(list).toBeDefined();
    expect(list.tagName).toBe('OL');

    // Each product has an h3 heading
    const productHeadings = screen.getAllByRole('heading', { level: 3 });
    // Filter heading is also an h3, product headings are the subsequent ones
    const productTitles = productHeadings.filter(h => h.textContent?.includes('Runner') || h.textContent?.includes('Walker') || h.textContent?.includes('Comfort'));
    expect(productTitles.length).toBe(3);
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
      name: /add UltraCushion Pro Runner to cart for ₹3,499/i,
    });
    fireEvent.click(firstCartBtn);
    expect(cartSpy).toHaveBeenCalledWith(mockShelfProducts[0]);
  });
});
