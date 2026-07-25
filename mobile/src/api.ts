import { makeFunctionReference } from "convex/server"

export const householdApi = {
  getCurrentViewer: makeFunctionReference<"query">(
    "household:getCurrentViewer",
  ),
  getMyContactProfile: makeFunctionReference<"query">(
    "household:getMyContactProfile",
  ),
  saveMyContactProfile: makeFunctionReference<"action">(
    "household:saveMyContactProfile",
  ),
  changeMyPassword: makeFunctionReference<"action">(
    "household:changeMyPassword",
  ),
  resetPasswordWithRecoveryCode: makeFunctionReference<"action">(
    "household:resetPasswordWithRecoveryCode",
  ),
  listAggregateTasks: makeFunctionReference<"query">(
    "household:listAggregateTasks",
  ),
  createTask: makeFunctionReference<"mutation">("household:createTask"),
  toggleTaskDone: makeFunctionReference<"mutation">(
    "household:toggleTaskDone",
  ),
}
