/** An error whose message is safe to show to the end user. */
export class AppError extends Error {
  constructor(message: string, public code = "BUSINESS_RULE") {
    super(message);
    this.name = "AppError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super(message, "FORBIDDEN");
  }
}

export class NotFoundError extends AppError {
  constructor(what = "Record") {
    super(`${what} not found.`, "NOT_FOUND");
  }
}
