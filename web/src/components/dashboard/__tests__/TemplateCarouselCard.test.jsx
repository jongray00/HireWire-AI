import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import TemplateCarouselCard from "../TemplateCarouselCard";

const sampleTemplates = [
  { id: "a", name: "Alpha",   description: "A", color: "blue",   icon: () => null, defaultData: {} },
  { id: "b", name: "Bravo",   description: "B", color: "green",  icon: () => null, defaultData: {} },
  { id: "c", name: "Charlie", description: "C", color: "purple", icon: () => null, defaultData: {} },
  { id: "d", name: "Delta",   description: "D", color: "orange", icon: () => null, defaultData: {} },
  { id: "e", name: "Echo",    description: "E", color: "pink",   icon: () => null, defaultData: {} },
];

const renderWith = (templates) =>
  render(
    <MemoryRouter>
      <TemplateCarouselCard templates={templates} />
    </MemoryRouter>
  );

describe("TemplateCarouselCard", () => {
  it("renders the title", () => {
    renderWith(sampleTemplates);
    expect(screen.getByText(/pick a template/i)).toBeInTheDocument();
  });

  it("renders up to 4 template tiles", () => {
    renderWith(sampleTemplates);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
    expect(screen.getByText("Delta")).toBeInTheDocument();
    expect(screen.queryByText("Echo")).not.toBeInTheDocument();
  });

  it("'Browse all N' link goes to /dashboard/templates with correct count", () => {
    renderWith(sampleTemplates);
    const link = screen.getByRole("link", { name: /browse all 5/i });
    expect(link).toHaveAttribute("href", "/dashboard/templates");
  });

  it("renders an empty-state link when no templates are passed", () => {
    renderWith([]);
    const link = screen.getByRole("link", { name: /browse all/i });
    expect(link).toHaveAttribute("href", "/dashboard/templates");
  });
});
