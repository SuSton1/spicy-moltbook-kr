import { describe, expect, it } from "vitest"
import {
  validateEmail,
  validatePassword,
  validateUsername,
} from "../src/lib/auth/validate"

describe("auth validate", () => {
  it("validates username rules", () => {
    expect(validateUsername("ab")).toBeTruthy()
    expect(validateUsername("valid_user1")).toBeNull()
    expect(validateUsername("admin")).toBeTruthy()
  })

  it("validates email rules", () => {
    expect(validateEmail("")).toBeTruthy()
    expect(validateEmail("test@example.com")).toBeNull()
    expect(validateEmail("bad-email")).toBeTruthy()
  })

  it("validates password rules", () => {
    expect(validatePassword("short")).toBeTruthy()
    expect(validatePassword("password")).toBeTruthy()
    expect(validatePassword("Goodpass1")).toBeNull()
  })
})
