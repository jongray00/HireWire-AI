# SignalWire Dark/Light Mode Implementation

## ✅ Implementation Complete

A comprehensive dark/light mode theme system has been implemented following **SignalWire Brand Guidelines v1.0**.

---

## 📦 What Was Implemented

### 1. **Theme Store** (`web/src/app/stores/theme.ts`)
- Zustand store with localStorage persistence
- Theme state management
- `theme`, `setTheme()`, `toggleTheme()` functions

### 2. **Theme Provider** (`web/src/app/components/ThemeProvider.tsx`)
- Syncs theme state with DOM
- Applies `.light` or `.dark` class to `<html>`
- Integrated into app root layout

### 3. **Theme Toggle Components** (`web/src/app/components/ThemeToggle.tsx`)
- **ThemeToggle**: Floating animated button with sun/moon icons
- **ThemeToggleCompact**: Inline compact version for navbars
- Smooth transitions and animations

### 4. **SignalWire Color System** (`web/tailwind.config.js`)
Extended Tailwind with complete SignalWire brand palette:
- **Primary**: `sw-blue`, `sw-pink`, `sw-mist`, `sw-breeze`, `sw-deepSea`, `sw-charcoal`
- **Neutrals**: `sw-grey-2`, `sw-grey-4`, `sw-grey-6`, `sw-grey-8`
- **Secondary**: `sw-green`, `sw-yellow`, `sw-purple`, `sw-red`
- **Semantic tokens**: `bg-theme-primary`, `text-theme-primary`, etc.

### 5. **CSS Variables** (`web/src/app/global.css`)
- Complete light/dark mode color tokens
- RGB format for alpha transparency support
- Smooth transitions on theme change
- Follows brand guideline: Blue primary in light, Pink primary in dark

### 6. **Demo Page** (`web/src/app/components/ThemeDemo.tsx`)
Comprehensive showcase including:
- All SignalWire brand colors
- Interactive elements (buttons, forms, cards)
- Typography samples
- Theme toggle demonstrations
- Status indicators

### 7. **Documentation** (`web/THEME_GUIDE.md`)
Complete guide with:
- Quick start instructions
- Color system reference
- Common UI patterns
- Best practices
- Architecture overview

---

## 🎨 Key Features

### ✅ **Brand Compliance**
- Follows SignalWire Brand Guidelines v1.0 exactly
- Blue primary in light mode, Pink primary in dark mode
- Official color palette: Blue (#044ef4), Pink (#f72a72), etc.
- Typography: Neue Einstellung for headings, Inter for body

### ✅ **Developer Experience**
- Zero configuration - works immediately
- TypeScript support throughout
- Intuitive API: `useThemeStore()` hook
- Semantic CSS classes for easy theming

### ✅ **User Experience**
- Persistent theme preference (localStorage)
- Smooth color transitions
- Animated toggle buttons
- Accessible with ARIA labels

### ✅ **Technical Quality**
- Built with Zustand (already in dependencies)
- Tailwind CSS integration
- React 18 compatible
- No extra dependencies needed

---

## 🚀 How to Use

### Basic Usage

```tsx
import { ThemeToggle } from '~/app/components/ThemeToggle';
import { useThemeStore } from '~/app/stores/theme';

export function MyComponent() {
  const { theme } = useThemeStore();

  return (
    <div className="bg-theme-primary text-theme-primary">
      <h1 className="text-sw-blue dark:text-sw-pink">
        Hello SignalWire!
      </h1>
      <ThemeToggle />
    </div>
  );
}
```

### Using SignalWire Colors

```tsx
// Primary brand colors (automatic theme adaptation)
<button className="bg-sw-blue dark:bg-sw-pink text-white">
  Primary Action
</button>

// Semantic tokens (auto-adapt to theme)
<div className="bg-theme-primary text-theme-primary border border-theme-border">
  Themed Content
</div>

// Status colors (consistent across themes)
<span className="text-sw-green">Success</span>
<span className="text-sw-yellow">Warning</span>
<span className="text-sw-red">Error</span>
```

---

## 📁 File Structure

```
web/
├── src/app/
│   ├── stores/
│   │   └── theme.ts                 # Theme state store
│   ├── components/
│   │   ├── ThemeProvider.tsx        # Theme provider
│   │   ├── ThemeToggle.tsx          # Toggle buttons
│   │   └── ThemeDemo.tsx            # Demo component
│   ├── global.css                   # Theme CSS variables
│   ├── root.tsx                     # App root (integrated)
│   └── page.jsx                     # Home page with demo
├── tailwind.config.js               # Extended with SW colors
└── THEME_GUIDE.md                   # Complete documentation
```

---

## 🎯 Brand Guideline Interpretation

### Light Mode
- **Primary Accent**: SignalWire Blue (#044ef4)
- **Backgrounds**: White → Mist → Grey 8
- **Text**: Charcoal → Grey 2 → Grey 4
- **Use Case**: Primary interface for logos, links, fills

### Dark Mode
- **Primary Accent**: SignalWire Pink (#f72a72) ⭐
- **Backgrounds**: Charcoal → Dark variants
- **Text**: White → Grey 6 → Grey 4
- **Use Case**: Dark backgrounds per brand guidelines

### Key Insight from Guidelines
The brand guidelines explicitly state:
- **Blue** = "Logo, links, fills, accents on **light backgrounds**"
- **Pink** = "Logo, accents, callouts on **dark backgrounds**"

This is why the implementation automatically switches the primary accent color based on theme!

---

## 🎪 Demo

The implementation includes a live demo at the root route (`/`) showcasing:

1. **Brand Identity** - SignalWire's core values
2. **Primary Colors** - Blue, Pink, Mist, Breeze, Deep Sea
3. **Neutral Colors** - Complete grayscale palette
4. **Secondary Colors** - Green, Yellow, Purple, Red
5. **Interactive Elements** - Buttons, inputs, cards
6. **Typography** - Neue Einstellung & Inter fonts
7. **Theme Toggles** - Both button variants

---

## 📚 Documentation

Comprehensive documentation is available in:
- **`web/THEME_GUIDE.md`** - Complete usage guide with examples
- **Inline comments** - All components are well-documented
- **TypeScript types** - Full type safety throughout

---

## ✨ Next Steps

The theme system is ready to use! To integrate into your app:

1. **Import the toggle**: Add `<ThemeToggle />` to your header/nav
2. **Use semantic classes**: Replace hardcoded colors with theme tokens
3. **Test both themes**: Check components in light and dark modes
4. **Follow the guide**: Reference `THEME_GUIDE.md` for patterns

---

## 🎉 Summary

✅ Full light/dark mode implementation
✅ SignalWire brand colors integrated
✅ Persistent user preferences
✅ Smooth transitions
✅ Zero additional dependencies
✅ TypeScript support
✅ Comprehensive documentation
✅ Live demo included

The theme system is production-ready and follows all SignalWire brand guidelines!
