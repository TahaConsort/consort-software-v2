import * as customerService from "@/services/customerService";
import { createResourceStore } from "@/lib/createResourceStore";
import { TOPICS } from "@/lib/topics";

/**
 * Customer store — the Company, Contact & Customer list.
 *
 * Four screens share this one array (Customers, Queries, Visits, Outreach), and it used
 * to have no mutations at all: customers are born from lead conversion (RULE-LD-05) and
 * edited from the list page, and neither path refreshed it. Convert a lead and the new
 * customer was missing from every target picker; edit credit terms and nothing moved.
 * It now owns `customers`, which lead conversion publishes.
 */
export const useCustomerStore = createResourceStore({
  name: "customers",
  topics: [TOPICS.CUSTOMERS],

  state: { customers: [] },

  load: async () => {
    const res = await customerService.listCustomers();
    return { customers: res.data ?? [] };
  },

  actions: ({ get, mutate }) => {
    const customerTopics = [TOPICS.CUSTOMERS, TOPICS.DASHBOARD];

    return {
      fetchCustomers: () => get().fetch(),

      updateCustomer: (id, payload) =>
        mutate(() => customerService.updateCustomer(id, payload), { invalidates: customerTopics }),

      updateCompany: (id, payload) =>
        mutate(() => customerService.updateCompany(id, payload), { invalidates: customerTopics }),

      addContact: (companyId, payload) =>
        mutate(() => customerService.addContact(companyId, payload), { invalidates: customerTopics }),

      updateContact: (contactId, payload) =>
        mutate(() => customerService.updateContact(contactId, payload), { invalidates: customerTopics }),

      /** Creates a portal User for the customer, so the employee list changes too. */
      createPortalUser: (customerId, email) =>
        mutate(() => customerService.createPortalUser(customerId, email), {
          invalidates: [...customerTopics, TOPICS.EMPLOYEES],
        }),
    };
  },
});
