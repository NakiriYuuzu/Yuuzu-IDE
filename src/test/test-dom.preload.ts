// bun test preload (see bunfig.toml): make the DOM available before any test
// file evaluates so @testing-library/dom binds `screen` to a real document.
import { ensureTestDom } from "./test-dom";

ensureTestDom();
