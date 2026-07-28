import { AppError } from '../utils/AppError.js';
import { ZodError } from 'zod';

const toMessage = (err) => {
  const issues = err.issues || err.errors || [];
  return issues.length
    ? issues
        .map((issue) => {
          const path = issue.path?.length ? `${issue.path.join('.')}: ` : '';
          return `${path}${issue.message}`;
        })
        .join(', ')
    : 'Invalid request payload';
};

export const validate = (schema) => (req, res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (err) {
    if (err instanceof ZodError) {
      return next(new AppError(`Validation Error: ${toMessage(err)}`, 400));
    }
    next(err);
  }
};

// Validate req.query without reassigning it (Express 5 query is a getter).
export const validateQuery = (schema) => (req, res, next) => {
  try {
    schema.parse(req.query);
    next();
  } catch (err) {
    if (err instanceof ZodError) {
      return next(new AppError(`Validation Error: ${toMessage(err)}`, 400));
    }
    next(err);
  }
};
