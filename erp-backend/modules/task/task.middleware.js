import { requireRole, isManagement, hasRole } from "../auth/auth.middleware.js";
import { teamUserIds } from "../lead/lead.middleware.js";
import { getUserDepartmentId } from "../chat/chat.service.js";

/**
 * Task access + scope (BUSINESS_RULES §2.2/2.3, RULE-TK).
 *   Management                read all (A)
 *   Dept managers (ops/comp/transport)   department queue (D)
 *   Executives (ops_exec/comp_exec/accounts)  own + claimable dept queue (O)
 *   ASM  team (T)     BDO  own (O)
 *
 * req.taskScope:
 *   null                          → unrestricted (Management, read)
 *   { departmentId }              → whole department queue (managers)
 *   { departmentId, selfId }      → own tasks + unassigned dept queue (execs)
 *   { assigneeIds: [...] }        → assignee in this set (sales)
 */
export const requireTaskAccess = requireRole(
  "ceo",
  "project_director",
  "director",
  "cfo",
  "gm",
  "asm",
  "bdo",
  "ops_manager",
  "ops_exec",
  "compliance_manager",
  "compliance_exec",
  "transport_manager",
  "transport_exec",
  "accounts",
);

const DEPT_MANAGERS = ["ops_manager", "compliance_manager", "transport_manager"];
const DEPT_EXECS = ["ops_exec", "compliance_exec", "transport_exec", "accounts"];

export const attachTaskScope = async (req, res, next) => {
  try {
    // Broadest task view wins for a multi-role user.
    const isMgr = DEPT_MANAGERS.some((r) => hasRole(req.user, r));
    const isExec = DEPT_EXECS.some((r) => hasRole(req.user, r));
    if (isManagement(req.user)) {
      req.taskScope = null;
    } else if (isMgr) {
      req.taskScope = { departmentId: await getUserDepartmentId(req.user.id) };
    } else if (isExec) {
      req.taskScope = { departmentId: await getUserDepartmentId(req.user.id), selfId: req.user.id };
    } else if (hasRole(req.user, "asm")) {
      req.taskScope = { assigneeIds: await teamUserIds(req.user) };
    } else {
      req.taskScope = { assigneeIds: [req.user.id] }; // bdo
    }
    next();
  } catch (err) {
    next(err);
  }
};

export const scopedTaskWhere = (req, extra = {}) => {
  const scope = req.taskScope;
  if (!scope) return extra;
  if (scope.assigneeIds) return { ...extra, assigneeId: { in: scope.assigneeIds } };
  if (scope.selfId) {
    // own tasks OR unassigned tasks in the department (claimable queue)
    return {
      ...extra,
      OR: [
        { assigneeId: scope.selfId },
        { assigneeId: null, departmentId: scope.departmentId },
      ],
    };
  }
  return { ...extra, departmentId: scope.departmentId };
};

export const taskInScope = (req, task) => {
  const scope = req.taskScope;
  if (!scope) return true;
  if (scope.assigneeIds) return scope.assigneeIds.includes(task.assigneeId);
  if (scope.selfId) return task.assigneeId === scope.selfId || (task.assigneeId === null && task.departmentId === scope.departmentId);
  return task.departmentId === scope.departmentId;
};
