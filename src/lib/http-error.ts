export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Page') => new HttpError(404, `${what} introuvable`);
export const forbidden = () => new HttpError(403, 'Vous n’avez pas accès à cette page');
