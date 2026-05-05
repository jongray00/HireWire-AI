import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PhoneNumberPicker from "../PhoneNumberPicker";

const credentials = {
  spaceUrl: "demo.signalwire.com",
  projectId: "p",
  apiToken: "t",
};

beforeEach(() => {
  global.fetch = vi.fn(() =>
    Promise.resolve({
      json: () =>
        Promise.resolve({
          success: true,
          phoneNumbers: [
            { sid: "PN1", phoneNumber: "+15551234567", friendlyName: "Sales line" },
          ],
        }),
    })
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PhoneNumberPicker", () => {
  it("renders the combobox variant with text input + caret button", async () => {
    render(
      <PhoneNumberPicker
        value=""
        onChange={() => {}}
        label="Transfer To Number"
        credentials={credentials}
        variant="combobox"
      />
    );
    expect(screen.getByLabelText(/transfer to number/i)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /open phone number list/i })).toBeEnabled()
    );
  });

  it("combobox popover lists numbers with friendly names", async () => {
    render(
      <PhoneNumberPicker
        value=""
        onChange={() => {}}
        label="Transfer To Number"
        credentials={credentials}
        variant="combobox"
      />
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /open phone number list/i })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole("button", { name: /open phone number list/i }));
    expect(screen.getByText(/\+1 \(555\) 123-4567/)).toBeInTheDocument();
    expect(screen.getByText(/Sales line/)).toBeInTheDocument();
  });

  it("combobox passes typed values through to onChange", () => {
    const onChange = vi.fn();
    render(
      <PhoneNumberPicker
        value=""
        onChange={onChange}
        label="Transfer From"
        credentials={credentials}
        variant="combobox"
      />
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "+15559998888" } });
    expect(onChange).toHaveBeenCalledWith("+15559998888");
  });

  it("defaults to select variant when no variant prop is provided", async () => {
    render(
      <PhoneNumberPicker
        value=""
        onChange={() => {}}
        label="Phone Number"
        credentials={credentials}
      />
    );
    await waitFor(() => expect(screen.getByRole("combobox")).toBeInTheDocument());
  });
});
