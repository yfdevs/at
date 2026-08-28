export const IQIYI_DRAMA_PLATFORM = "iqiyi-drama";
export const IQIYI_SHORT_DRAMA_CREATE_URL =
  "https://creator.iqiyi.com/miniPlay/project/create";
export const IQIYI_COMIC_DRAMA_CREATE_URL =
  "https://creator.iqiyi.com/comicPlay/project/create";
export const IQIYI_DRAMA_LOGIN_URL =
  "https://creator.iqiyi.com/?from=https%3A%2F%2Fcreator.iqiyi.com%2FcomicPlay%2Fproject%2Fcreate&showLogin=1";

export function iqiyiCreateUrl(type: "short-drama" | "comic-drama") {
  return type === "comic-drama"
    ? IQIYI_COMIC_DRAMA_CREATE_URL
    : IQIYI_SHORT_DRAMA_CREATE_URL;
}
