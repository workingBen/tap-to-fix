import { boot } from "./loader";

boot(document, window, (u) => import(u));
