import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  formatName,
  isElectionEnded,
  isElectionOngoing,
  positionTemplate,
  takenSlugs,
} from "@eboto/constants";
import { sendVoteCasted } from "@eboto/email/emails/vote-casted";

import { env } from "../env.mjs";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";

export const electionRouter = createTRPCRouter({
  getElectionPage: publicProcedure
    .input(
      z.object({
        election_slug: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { data: election } = await ctx.supabase
        .from("elections")
        .select()
        .eq("slug", input.election_slug)
        .is("deleted_at", null)
        .single();

      if (!election) throw new TRPCError({ code: "NOT_FOUND" });

      const { data: voter_fields } = await ctx.supabase
        .from("voter_fields")
        .select()
        .eq("election_id", election.id)
        .is("deleted_at", null);

      const { data: commissioners } = await ctx.supabase
        .from("commissioners")
        .select("*, user: users(*)")
        .eq("election_id", election.id)
        .is("deleted_at", null);

      if (!voter_fields || !commissioners)
        throw new TRPCError({ code: "NOT_FOUND" });

      // const positions = await ctx.db.query.positions.findMany({
      //   where: (position, { eq, and, isNull }) =>
      //     and(
      //       eq(position.election_id, election.id),
      //       isNull(position.deleted_at),
      //     ),
      //   with: {
      //     candidates: {
      // TODO: not sure if this is correct
      //       where: (candidate, { eq, and, isNull }) =>
      //         and(
      //           eq(candidate.election_id, election.id),
      //           isNull(candidate.deleted_at),
      //         ),
      //       with: {
      //         partylist: true,
      //       },
      //     },
      //   },
      //   orderBy: (positions, { asc }) => [asc(positions.order)],
      // });

      const { data: positions, error: positions_error } = await ctx.supabase
        .from("positions")
        .select("*, candidates(*, partylist: partylists(*))")
        .eq("election_id", election.id)
        .is("deleted_at", null)
        .order("order", { ascending: true });

      if (positions_error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: positions_error.message,
        });

      const { data: myVoterData } = await ctx.supabase
        .from("voters")
        .select()
        .eq("election_id", election.id)
        .eq("email", ctx.session?.user.email ?? "")
        .is("deleted_at", null)
        .single();

      const { data: hasVoted } = await ctx.supabase
        .from("votes")
        .select()
        .eq("voter_id", myVoterData?.id ?? "")
        .eq("election_id", election.id)
        .single();

      return {
        election: {
          ...election,
          voter_fields,
          commissioners,
        },
        positions: positions.map((position) => ({
          ...position,
          candidates: position.candidates.map((candidate) => ({
            ...candidate,
            partylist: candidate.partylist!,
          })),
        })),
        isOngoing: isElectionOngoing({ election }),
        myVoterData,
        hasVoted: !!hasVoted,
        isVoterCanMessage:
          election.publicity !== "PRIVATE" &&
          !!myVoterData &&
          !commissioners?.some(
            (commissioner) =>
              commissioner.user?.email === ctx.session?.user.email,
          ),
      };
    }),
  vote: protectedProcedure
    .input(
      z.object({
        election_id: z.string(),
        votes: z.array(
          z.object({
            position_id: z.string(),
            votes: z
              .object({
                isAbstain: z.literal(true),
              })
              .or(
                z.object({
                  isAbstain: z.literal(false),
                  candidates: z.array(z.string()),
                }),
              ),
          }),
        ),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // TODO: use transaction
      const { data: election } = await ctx.supabase
        .from("elections")
        .select()
        .eq("id", input.election_id)
        .is("deleted_at", null)
        .single();

      if (!election) throw new TRPCError({ code: "NOT_FOUND" });

      if (!isElectionOngoing({ election }))
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Election is not ongoing",
        });

      const { data: existingVotes } = await ctx.supabase
        .from("votes")
        .select()
        .eq("voter_id", ctx.session.user.id)
        .eq("election_id", election.id)
        .single();

      if (existingVotes)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You have already voted in this election",
        });

      const { data: isVoterExists } = await ctx.supabase
        .from("voters")
        .select()
        .eq("election_id", election.id)
        .eq("email", ctx.session.user.email ?? "")
        .is("deleted_at", null)
        .single();

      if (!isVoterExists)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not a voter in this election",
        });

      await ctx.supabase.from("votes").insert(
        input.votes
          .map((vote) =>
            vote.votes.isAbstain
              ? {
                  position_id: vote.position_id,
                  voter_id: isVoterExists.id,
                  election_id: input.election_id,
                }
              : vote.votes.candidates.map((candidate_id) => ({
                  candidate_id,
                  voter_id: isVoterExists.id,
                  election_id: input.election_id,
                })),
          )
          .flat(),
      );

      if (ctx.session.user.email) {
        const { data: positions } = await ctx.supabase
          .from("positions")
          .select()
          .eq("election_id", input.election_id)
          .is("deleted_at", null)
          .order("order", { ascending: true });

        const { data: candidates } = await ctx.supabase
          .from("candidates")
          .select()
          .eq("election_id", input.election_id)
          .is("deleted_at", null);

        if (!positions || !candidates)
          throw new TRPCError({ code: "NOT_FOUND" });

        await sendVoteCasted({
          email: ctx.session.user.email,
          election: {
            name: election.name,
            slug: election.slug,

            positions: input.votes.map((vote) => ({
              id: vote.position_id,
              name:
                positions.find((position) => position.id === vote.position_id)
                  ?.name ?? "",
              vote: !vote.votes.isAbstain
                ? {
                    isAbstain: false,
                    candidates: vote.votes.candidates.map((candidate_id) => {
                      const candidate = candidates.find(
                        (candidate) => candidate.id === candidate_id,
                      );

                      return {
                        id: candidate?.id ?? "",
                        name: `${formatName(
                          election.name_arrangement,
                          candidate!,
                        )}`,
                      };
                    }),
                  }
                : { isAbstain: true },
            })),
          },
        });
      }
    }),
  getElectionBySlug: publicProcedure
    .input(
      z.object({
        election_slug: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { data: election } = await ctx.supabase
        .from("elections")
        .select()
        .eq("slug", input.election_slug)
        .is("deleted_at", null)
        .single();

      if (!election) throw new TRPCError({ code: "NOT_FOUND" });

      return election;
    }),
  getDashboardOverviewData: protectedProcedure
    .input(
      z.object({
        election_slug: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { data: election } = await ctx.supabase
        .from("elections")
        .select(
          `
          *,
          positions(*),
          partylists(*),
          voters(*, votes(*)),
          generated_election_results(*, election: elections(*, positions(*, votes(*), candidates(*, votes(*))))),
          candidates(*)
        `,
        )
        .eq("slug", input.election_slug)
        .is("deleted_at", null)
        .neq("partylists.acronym", "IND")
        .is("partylists.deleted_at", null)
        .is("voters.deleted_at", null)
        .is("candidates.deleted_at", null)
        .single();

      if (!election) throw new TRPCError({ code: "NOT_FOUND" });

      return {
        ...election,
        generated_election_results: election.generated_election_results.map(
          (result) => ({
            ...result,
            election: {
              ...result.election!,
              positions: result.election!.positions.map((position) => ({
                ...position,
                abstain_count: position.votes.length,
                candidates: position.candidates.map((candidate) => ({
                  ...candidate,
                  vote_count: candidate.votes.length,
                })),
              })),
            },
          }),
        ),
      };
    }),
  reportAProblem: protectedProcedure
    .input(
      z.object({
        subject: z.string().min(1),
        description: z.string().min(1),
        election_id: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await ctx.supabase.from("reported_problems").insert({
        subject: input.subject,
        description: input.description,
        election_id: input.election_id,
        user_id: ctx.session.user.id,
      });
    }),
  getElectionVoting: publicProcedure
    .input(z.string())
    .query(async ({ input, ctx }) => {
      const { data: positions, error: positions_error } = await ctx.supabase
        .from("positions")
        .select("*, candidates(*, partylist: partylists(*))")
        .eq("election_id", input)
        .is("deleted_at", null)
        .order("order", { ascending: true })
        .eq("candidates:election_id", input)
        .is("candidates:deleted_at", null);

      if (positions_error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: positions_error.message,
        });

      return positions.map((position) => ({
        ...position,
        candidates: position.candidates.map((candidate) => ({
          ...candidate,
          // TODO: uncomment this
          partylist: candidate.partylist!,
        })),
      }));
    }),
  getElectionRealtime: publicProcedure
    .input(z.string())
    .query(async ({ input, ctx }) => {
      const { data: election } = await ctx.supabase
        .from("elections")
        .select()
        .eq("slug", input)
        .is("deleted_at", null)
        .single();

      if (!election) throw new Error("Election not found");

      // const is_free = election.variant_id === env.LEMONSQUEEZY_FREE_VARIANT_ID;
      const date = new Date();
      date.setMinutes(0);
      date.setSeconds(0);

      // const realtimeResult = await ctx.db.query.positions.findMany({
      //   where: (position, { eq, and, isNull }) =>
      //     and(
      //       eq(position.election_id, election.id),
      //       isNull(position.deleted_at),
      //     ),
      //   orderBy: (position, { asc }) => asc(position.order),
      //   with: {
      //     votes: {
      //       where: (vote, { lte }) =>
      //         is_free ? lte(vote.created_at, date) : undefined,
      //     },
      //     candidates: {
      //       where: (candidate, { eq, and, isNull }) =>
      //         and(
      //           eq(candidate.election_id, election.id),
      //           isNull(candidate.deleted_at),
      //         ),
      //       with: {
      //         votes: {
      //           where: (vote, { lte }) =>
      //             is_free ? lte(vote.created_at, date) : undefined,
      //           with: {
      //             candidate: true,
      //           },
      //         },
      //         partylist: {
      //           columns: {
      //             acronym: true,
      //           },
      //         },
      //       },
      //     },
      //   },
      // });

      const { data: realtimeResult } = await ctx.supabase
        .from("positions")
        .select(
          `
          *,
          votes(*),
          candidates(*, votes(*, candidate(*)), partylist:partylists(*))
        `,
        )
        .eq("election_id", election.id)
        .is("deleted_at", null)
        .order("order", { ascending: true })
        .eq("votes:election_id", election.id)
        .lte("votes:created_at", date)
        .eq("candidates:election_id", election.id)
        .is("candidates:deleted_at", null)
        .lte("candidates:votes:created_at", date)
        .eq("candidates:votes:election_id", election.id);

      if (!realtimeResult) throw new TRPCError({ code: "NOT_FOUND" });

      // make the candidate as "Candidate 1"... "Candidate N" if the election is ongoing

      return {
        positions: realtimeResult.map((position) => ({
          ...position,
          votes: position.votes.length,
          candidates: position.candidates
            .sort((a, b) => b.votes.length - a.votes.length)
            .map((candidate, index) => {
              return {
                id: candidate.id,
                name:
                  !election.is_candidates_visible_in_realtime_when_ongoing &&
                  isElectionOngoing({ election }) &&
                  !isElectionEnded({ election })
                    ? `Candidate ${index + 1}`
                    : `${formatName(election.name_arrangement, candidate)} (${
                        candidate.partylist?.acronym
                      })`,
                vote: candidate.votes.length,
              };
            }),
        })),
      };
    }),
  getAllMyElections: protectedProcedure.query(async ({ ctx }) => {
    const { data: commissioners } = await ctx.supabase
      .from("commissioners")
      .select("*, election: elections(*, commissioners(*, user:users(*)))")
      .eq("user_id", ctx.session.user.id)
      .is("deleted_at", null)
      .is("elections.commissioners.deleted_at", null)
      .order("created_at", {
        referencedTable: "elections.commissioners",
        ascending: true,
      })
      .order("created_at", { ascending: true });

    if (!commissioners) throw new TRPCError({ code: "NOT_FOUND" });

    return commissioners.map((commissioner) => ({
      ...commissioner,
      election: {
        ...commissioner.election!,
        isTheCreator:
          commissioner.user_id ===
          commissioner.election?.commissioners[0]?.user_id,
      },
    }));
  }),
  getVotersByElectionSlug: protectedProcedure
    .input(
      z.object({
        election_slug: z.string().min(1),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { data: election } = await ctx.supabase
        .from("elections")
        .select("*, voter_fields(*)")
        .eq("slug", input.election_slug)
        .is("deleted_at", null)
        .single();

      if (!election)
        throw new TRPCError({
          code: "NOT_FOUND",
        });

      const { data: votersFromDb } = await ctx.supabase
        .from("voters")
        // TODO: limit votes to 1
        .select("*, votes:votes(*)")
        .eq("election_id", election.id)
        .is("deleted_at", null);

      if (!votersFromDb) throw new TRPCError({ code: "NOT_FOUND" });

      return {
        election,
        voters: votersFromDb.map((voter) => ({
          id: voter.id,
          email: voter.email,
          created_at: voter.created_at,
          field: voter.field,
          has_voted: !!voter.votes.length,
        })),
      };
    }),
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        slug: z.string().min(1).trim().toLowerCase(),
        date: z.custom<[string, string]>(),
        template: z.string(),
        voting_hours: z.array(z.number()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (takenSlugs.includes(input.slug)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Election slug is already exists",
        });
      }

      if (!Array.isArray(input.date) || input.date.length !== 2) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Date must be an array of 2",
        });
      }

      const { data: election_plus, error: election_plus_error } =
        await ctx.supabase
          .from("elections_plus")
          .select()
          .eq("user_id", ctx.session.user.id)
          .is("redeemed_at", null)
          .single();

      if (election_plus_error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: election_plus_error.message,
        });

      if (!election_plus)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You don't have the permission to create an election",
        });

      const { data: election } = await ctx.supabase
        .from("elections")
        .select("id")
        .eq("slug", input.slug)
        .is("deleted_at", null)
        .single();

      if (election) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Election slug is already exists",
        });
      }

      // TODO: use transaction
      const { data: create_election, error: create_election_error } =
        await ctx.supabase
          .from("elections")
          .insert({
            name: input.name,
            slug: input.slug,
            start_date: input.date[0],
            end_date: input.date[1],
            voting_hour_start: input.voting_hours[0],
            voting_hour_end: input.voting_hours[1],
            variant_id: env.LEMONSQUEEZY_FREE_VARIANT_ID,
          })
          .select("id")
          .single();

      if (create_election_error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: create_election_error.message,
        });

      const { error: commissioners_error } = await ctx.supabase
        .from("commissioners")
        .insert({
          election_id: create_election.id,
          user_id: ctx.session.user.id,
        });

      if (commissioners_error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: commissioners_error.message,
        });

      const { error: partylist_error } = await ctx.supabase
        .from("partylists")
        .insert({
          name: "Independent",
          acronym: "IND",
          election_id: create_election.id,
        });

      if (partylist_error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: partylist_error.message,
        });

      const positionsInTemplate =
        positionTemplate
          .find((template) =>
            template.organizations.find(
              (organization) => organization.id === input.template,
            ),
          )
          ?.organizations.find(
            (organization) => organization.id === input.template,
          )
          ?.positions.map((position, i) => ({
            name: position,
            order: i,
            election_id: create_election.id,
          })) ?? [];
      if (input.template !== "none" && positionsInTemplate.length > 0) {
        const { error: positions_error } = await ctx.supabase
          .from("positions")
          .insert(positionsInTemplate);

        if (positions_error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: positions_error.message,
          });
      }

      await ctx.supabase
        .from("elections_plus")
        .update({ redeemed_at: new Date().toISOString() })
        .eq("id", election_plus.id);
    }),
  edit: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        description: z.string().nullable(),
        oldSlug: z.string().trim().toLowerCase(),
        newSlug: z.string().min(1).trim().toLowerCase(),
        date: z.custom<[string, string]>(),
        publicity: z.enum(["PUBLIC", "PRIVATE", "VOTER"] as const),
        is_candidates_visible_in_realtime_when_ongoing: z.boolean(),
        // voter_domain: z.string().nullable(),
        voting_hours: z.custom<[number, number]>(),
        logo: z
          .object({
            name: z.string().min(1),
            type: z.string().min(1),
            base64: z.string().min(1),
          })
          .nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.newSlug !== input.oldSlug) {
        if (takenSlugs.includes(input.newSlug)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Election slug is already exists",
          });
        }

        // if (input.voter_domain) {
        //   if (input.voter_domain === "gmail.com")
        //     throw new TRPCError({
        //       code: "BAD_REQUEST",
        //       message: "Gmail is not allowed",
        //     });

        //   if (input.voter_domain.includes("@"))
        //     throw new TRPCError({
        //       code: "BAD_REQUEST",
        //       message: "Please enter only the domain name",
        //     });
        // }

        const { data: election } = await ctx.supabase
          .from("elections")
          .select()
          .eq("slug", input.newSlug)
          .is("deleted_at", null)
          .single();

        if (election)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Election slug is already exists",
          });
      }

      // TODO: use transaction
      const { data: isElectionCommissionerExists } = await ctx.supabase
        .from("elections")
        .select("*, commissioners(*)")
        .eq("id", input.id)
        .is("deleted_at", null)
        .eq("commissioners.user_id", ctx.session.user.id)
        .is("commissioners.deleted_at", null)
        .single();

      if (
        !isElectionCommissionerExists ||
        (isElectionCommissionerExists &&
          isElectionCommissionerExists.commissioners.length === 0)
      ) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Unauthorized",
        });
      }

      if (
        isElectionCommissionerExists.logo_path &&
        (input.logo === null || input.logo)
      ) {
        await ctx.supabase.storage
          .from("elections")
          .remove([isElectionCommissionerExists.logo_path]);
      }

      const isElectionDatesDisabled =
        isElectionOngoing({ election: isElectionCommissionerExists }) ||
        isElectionEnded({ election: isElectionCommissionerExists });

      await ctx.supabase
        .from("elections")
        .update({
          name: input.name,
          slug: input.newSlug,
          description: input.description,
          publicity: input.publicity,
          start_date: !isElectionDatesDisabled ? input.date[0] : undefined,
          end_date: !isElectionDatesDisabled ? input.date[1] : undefined,
          // voter_domain: !isElectionDatesDisabled ? input.voter_domain : undefined,
          is_candidates_visible_in_realtime_when_ongoing:
            input.is_candidates_visible_in_realtime_when_ongoing,
          voting_hour_start: !isElectionDatesDisabled
            ? input.voting_hours[0]
            : undefined,
          voting_hour_end: !isElectionDatesDisabled
            ? input.voting_hours[1]
            : undefined,
          // TODO: uncomment this when the logo is ready
          // logo: input.logo
          //   ? await fetch(input.logo.base64)
          //       .then((res) => res.blob())
          //       .then(
          //         async (blob) =>
          //           (
          //             await ctx.utapi.uploadFiles(
          //               new File(
          //                 [blob],
          //                 `election_logo_${input.id}_${input.logo!.name}`,
          //                 {
          //                   type: input.logo!.type,
          //                 },
          //               ),
          //             )
          //           ).data,
          //       )
          //   : input.logo,
        })
        .eq("id", input.id);
    }),
  delete: protectedProcedure
    .input(
      z.object({
        election_id: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // TODO: use transaction
      await ctx.supabase
        .from("commissioners")
        .update({
          deleted_at: new Date().toISOString(),
        })
        .eq("election_id", input.election_id);
      await ctx.supabase
        .from("elections")
        .update({
          deleted_at: new Date().toISOString(),
        })
        .eq("id", input.election_id);
    }),
  getVoterFieldsStats: protectedProcedure
    .input(
      z.object({
        election_id: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { data: election } = await ctx.supabase
        .from("elections")
        .select("*, voter_fields(*)")
        .eq("id", input.election_id)
        .is("deleted_at", null)
        .single();

      const { data: voters } = await ctx.supabase
        .from("voters")
        .select("*, votes(*)")
        .eq("election_id", input.election_id)
        .is("deleted_at", null);

      if (!election || !voters) throw new TRPCError({ code: "NOT_FOUND" });

      const fields = [];

      for (const field of election.voter_fields) {
        const fieldOptions = [] as {
          name: string;
          vote_count: number;
        }[];

        for (const voter of voters) {
          const optionName =
            (voter.field as Record<string, string> | null)?.[field.id] ?? "";
          const voteCount = voter.votes.length > 0 ? 1 : 0;

          const existingOption = fieldOptions.find(
            (option) => option.name === optionName,
          );

          if (existingOption) {
            existingOption.vote_count += voteCount;
          } else {
            fieldOptions.push({
              name: optionName,
              vote_count: voteCount,
            });
          }
        }

        fields.push({
          id: field.id,
          name: field.name,
          created_at: field.created_at,
          options: fieldOptions,
        });
      }
      return fields;
    }),
  getVoterFieldsStatsInRealtime: publicProcedure
    .input(
      z.object({
        election_id: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { data: election } = await ctx.supabase
        .from("elections")
        .select("*, voter_fields(*)")
        .eq("id", input.election_id)
        .is("deleted_at", null)
        .single();

      if (!election) throw new TRPCError({ code: "NOT_FOUND" });

      if (!ctx.session && election.publicity !== "PUBLIC")
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Election is not public",
        });

      const date = new Date();
      date.setMinutes(0);
      date.setSeconds(0);

      // const voters = await ctx.db.query.voters.findMany({
      //   where: (voters, { eq }) => eq(voters.election_id, input.election_id),
      //   with: {
      //     votes: {
      //       where: (vote, { lte }) =>
      //         election.variant_id === env.LEMONSQUEEZY_FREE_VARIANT_ID
      //           ? lte(vote.created_at, date)
      //           : undefined,
      //     },
      //   },
      // });

      const { data: voters } =
        election.variant_id === env.LEMONSQUEEZY_FREE_VARIANT_ID
          ? await ctx.supabase
              .from("voters")
              .select("*, votes(*)")
              .eq("election_id", input.election_id)
              .is("deleted_at", null)
              .lte("votes:created_at", date)
          : await ctx.supabase
              .from("voters")
              .select("*, votes(*)")
              .eq("election_id", input.election_id)
              .is("deleted_at", null);

      if (!voters) throw new TRPCError({ code: "NOT_FOUND" });

      const fields = [];

      for (const field of election.voter_fields) {
        const fieldOptions = [] as {
          name: string;
          vote_count: number;
        }[];

        for (const voter of voters) {
          const optionName =
            (voter.field as Record<string, string> | null)?.[field.id] ?? "";
          const voteCount = voter.votes.length > 0 ? 1 : 0;

          const existingOption = fieldOptions.find(
            (option) => option.name === optionName,
          );

          if (existingOption) {
            existingOption.vote_count += voteCount;
          } else {
            fieldOptions.push({
              name: optionName,
              vote_count: voteCount,
            });
          }
        }

        fields.push({
          id: field.id,
          name: field.name,
          created_at: field.created_at,
          options: fieldOptions,
        });
      }
      return fields;
    }),
  getElectionProgress: protectedProcedure
    .input(
      z.object({
        election_id: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { data: election } = await ctx.supabase
        .from("elections")
        .select(
          `
          *,
          voters(*),
          partylists(*),
          positions(*),
          candidates(*)
        `,
        )
        .eq("id", input.election_id)
        .is("deleted_at", null)
        .is("voters.deleted_at", null)
        .limit(1, { referencedTable: "voters" })
        .is("partylists.deleted_at", null)
        .limit(2, { referencedTable: "partylists" })
        .is("positions.deleted_at", null)
        .limit(1, { referencedTable: "positions" })
        .is("candidates.deleted_at", null)
        .limit(1, { referencedTable: "candidates" })
        .limit(1)
        .single();

      if (!election) throw new TRPCError({ code: "NOT_FOUND" });

      if (isElectionEnded({ election })) return 7;

      if (isElectionOngoing({ election })) return 6;

      if (election.voters.length > 0) return 5;

      if (election.candidates.length > 0) return 4;

      if (election.positions.length > 0) return 3;

      if (election.partylists.length > 1) return 2;

      return 1;
    }),
  getAllPublicElections: publicProcedure.query(async ({ ctx }) => {
    const { data: elections } = await ctx.supabase
      .from("elections")
      .select()
      .eq("publicity", "PUBLIC")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (!elections) throw new TRPCError({ code: "NOT_FOUND" });

    return elections;
  }),
  getAllCommissionerByElectionSlug: protectedProcedure
    .input(z.object({ election_slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const { data: election } = await ctx.supabase
        .from("elections")
        .select(
          `
          *,
          commissioners(*, user:users(*))
        `,
        )
        .eq("slug", input.election_slug)
        .is("deleted_at", null)
        .is("commissioners.deleted_at", null)
        .order("created_at", {
          referencedTable: "commissioners",
          ascending: true,
        })
        .single();

      if (!election) throw new TRPCError({ code: "NOT_FOUND" });

      return election.commissioners.map((commissioner) => ({
        ...commissioner,
        user: {
          ...commissioner.user,
          isTheCreator:
            commissioner.user?.id === election.commissioners[0]?.user_id,
          isMe: commissioner.user?.id === ctx.session.user.id,
        },
      }));
    }),
  addCommissioner: protectedProcedure
    .input(
      z.object({
        election_id: z.string().min(1),
        email: z.string().email(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.session.user.email === input.email)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot add yourself as a commissioner",
        });

      // const election = await ctx.db.query.elections.findFirst({
      //   where: (elections, { eq, and, isNull }) =>
      //     and(
      //       eq(elections.id, input.election_id),
      //       isNull(elections.deleted_at),
      //     ),
      //   with: {
      //     commissioners: {
      //       where: (commissioners, { isNull }) =>
      //         isNull(commissioners.deleted_at),
      //       with: {
      //         user: true,
      //       },
      //     },
      //   },
      // });

      // TODO: not sure if this is the correct way
      const { data: election } = await ctx.supabase
        .from("elections")
        .select(
          `
          *,
          commissioners(*, user:users(*))
        `,
        )
        .eq("id", input.election_id)
        .is("deleted_at", null)
        .is("commissioners:deleted_at", null)
        .single();

      if (!election)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Election not found",
        });

      const { data: user } = await ctx.supabase
        .from("users")
        .select()
        .eq("email", input.email)
        .single();

      if (!user)
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

      const { data: isCommissionerExists } = await ctx.supabase
        .from("commissioners")
        .select()
        .eq("election_id", election.id)
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .single();

      if (isCommissionerExists)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Commissioner already exists",
        });

      await ctx.supabase.from("commissioners").insert({
        election_id: election.id,
        user_id: user.id,
      });
    }),
  deleteCommissioner: protectedProcedure
    .input(
      z.object({
        election_id: z.string().min(1),
        commissioner_id: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // check if the commissioner is the creator of the election

      // const election = await ctx.db.query.elections.findFirst({
      //   where: (elections, { eq, and, isNull }) =>
      //     and(
      //       eq(elections.id, input.election_id),
      //       isNull(elections.deleted_at),
      //     ),
      //   with: {
      //     commissioners: {
      //       where: (commissioners, { isNull }) =>
      //         isNull(commissioners.deleted_at),
      //       orderBy: (commissioners, { asc }) => asc(commissioners.created_at),
      //       with: {
      //         user: true,
      //       },
      //     },
      //   },
      // });

      // TODO: not sure if this is the correct way
      const { data: election } = await ctx.supabase
        .from("elections")
        .select(
          `
          *,
          commissioners(*, user:users(*))
        `,
        )
        .eq("id", input.election_id)
        .is("deleted_at", null)
        .is("commissioners:deleted_at", null)
        .single();

      if (!election)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Election not found",
        });

      if (election.commissioners[0]?.user_id === input.commissioner_id)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot remove the creator of the election",
        });

      if (election.commissioners.length === 1)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot remove the last commissioner of the election",
        });

      const { data: commissioner } = await ctx.supabase
        .from("commissioners")
        .select()
        .eq("id", input.commissioner_id)
        .eq("election_id", input.election_id)
        .is("deleted_at", null)
        .single();

      if (!commissioner)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Commissioner not found",
        });

      await ctx.supabase
        .from("commissioners")
        .update({
          deleted_at: new Date().toISOString(),
        })
        .eq("id", input.commissioner_id)
        .eq("election_id", input.election_id)
        .is("deleted_at", null);
    }),
  getMyElectionAsCommissioner: protectedProcedure.query(async ({ ctx }) => {
    // const electionsThatICanManage = await ctx.db.query.elections.findMany({
    //   where: (elections, { and, isNull }) => and(isNull(elections.deleted_at)),
    //   with: {
    //     commissioners: {
    //       where: (commissioners, { eq, and, isNull }) =>
    //         and(
    //           eq(commissioners.user_id, ctx.session.user.id),
    //           isNull(commissioners.deleted_at),
    //         ),
    //     },
    //   },
    // });

    // TODO: not sure if this is the correct way
    const { data: electionsThatICanManage } = await ctx.supabase
      .from("elections")
      .select("*, commissioners(*)")
      .is("deleted_at", null)
      .eq("commissioners.user_id", ctx.session.user.id)
      .is("commissioners.deleted_at", null);

    if (!electionsThatICanManage) throw new TRPCError({ code: "NOT_FOUND" });

    // const electionsAsCommissioner = await ctx.db.query.commissioners.findMany({
    //   where: (commissioners, { eq, and, inArray, isNull }) =>
    //     and(
    //       eq(commissioners.user_id, ctx.session.user.id),
    //       electionsThatICanManage.length
    //         ? inArray(
    //             commissioners.election_id,
    //             electionsThatICanManage.map((election) => election.id),
    //           )
    //         : undefined,
    //       isNull(commissioners.deleted_at),
    //     ),
    //   with: {
    //     election: true,
    //   },
    // });

    const { data: electionsAsCommissioner } = electionsThatICanManage.length
      ? await ctx.supabase
          .from("commissioners")
          .select("*, election: elections(*)")
          .eq("user_id", ctx.session.user.id)
          .is("deleted_at", null)
          .in(
            "election_id",
            electionsThatICanManage.map((election) => election.id),
          )
      : await ctx.supabase
          .from("commissioners")
          .select("*, election: elections(*)")
          .eq("user_id", ctx.session.user.id)
          .is("deleted_at", null);

    if (!electionsAsCommissioner) throw new TRPCError({ code: "NOT_FOUND" });

    return electionsAsCommissioner
      .map((commissioner) => ({
        ...commissioner.election!,
        is_free:
          commissioner.election?.variant_id ===
          env.LEMONSQUEEZY_FREE_VARIANT_ID,
      }))
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
  }),
  getMyElectionAsVoter: protectedProcedure.query(async ({ ctx }) => {
    // const electionsThatICanVoteIn = await ctx.db.query.elections.findMany({
    //   where: (elections, { and, isNull, ne }) =>
    //     and(
    //       isNull(elections.deleted_at),
    //       ne(elections.publicity, "PRIVATE"),
    //       // lte(elections.start_date, new Date(now.toDateString())),
    //       // gte(elections.end_date, new Date(now.toDateString())),
    //       // lte(elections.voting_hour_start, now.getHours()),
    //       // gte(elections.voting_hour_end, now.getHours()),
    //       // eq(elections.voter_domain, session.user.email?.split("@")[1] ?? ""),
    //     ),
    //   with: {
    //     voters: {
    //       where: (voters, { eq, and, isNull }) =>
    //         and(
    //           eq(voters.email, ctx.session.user.email ?? ""),
    //           isNull(voters.deleted_at),
    //         ),
    //       limit: 1,
    //     },
    //   },
    // });

    // TODO: not sure if this is the correct way
    const { data: electionsThatICanVoteIn } = await ctx.supabase
      .from("elections")
      .select("*, voters(*)")
      .neq("publicity", "PRIVATE")
      .is("deleted_at", null)
      .eq("voters.email", ctx.session.user.email ?? "")
      .is("voters.deleted_at", null);

    if (!electionsThatICanVoteIn) throw new TRPCError({ code: "NOT_FOUND" });

    const elections = electionsThatICanVoteIn.filter((election) =>
      isElectionOngoing({ election, withoutHours: true }),
    );

    // const electionsAsVoter = await ctx.db.query.voters.findMany({
    //   where: (voters, { eq, ne, and, inArray, isNull }) =>
    //     and(
    //       isNull(voters.deleted_at),
    //       eq(voters.email, ctx.session.user.email ?? ""),
    //       elections.length
    //         ? inArray(
    //             voters.election_id,
    //             elections.map((election) => election.id),
    //           )
    //         : ne(voters.email, ctx.session.user.email ?? ""),
    //     ),
    //   with: {
    //     election: {
    //       with: {
    //         votes: {
    //           where: (votes, { inArray }) =>
    //             electionsThatICanVoteIn.flatMap((election) =>
    //               election.voters.map((voter) => voter.id),
    //             ).length > 0
    //               ? inArray(
    //                   votes.voter_id,
    //                   electionsThatICanVoteIn.flatMap((election) =>
    //                     election.voters.map((voter) => voter.id),
    //                   ),
    //                 )
    //               : undefined,
    //           limit: 1,
    //         },
    //       },
    //     },
    //   },
    // });

    // TODO: not sure if this is the correct way
    const { data: electionsAsVoter } = elections.length
      ? await ctx.supabase
          .from("voters")
          .select("*, election: elections(*, votes(*))")
          .eq("email", ctx.session.user.email ?? "")
          .is("deleted_at", null)
          .in(
            "election_id",
            elections.map((election) => election.id),
          )
      : await ctx.supabase
          .from("voters")
          .select("*, election: elections(*, votes(*))")
          .eq("email", ctx.session.user.email ?? "")
          .is("deleted_at", null);

    if (!electionsAsVoter) throw new TRPCError({ code: "NOT_FOUND" });

    return electionsAsVoter
      .map((voter) => voter.election!)
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
  }),
  messageCommissioner: protectedProcedure
    .input(
      z.object({
        election_id: z.string().min(1),
        title: z.string().min(1),
        message: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // const election = await ctx.db.query.elections.findFirst({
      //   where: (elections, { eq, and, isNull, ne }) =>
      //     and(
      //       eq(elections.id, input.election_id),
      //       isNull(elections.deleted_at),
      //       ne(elections.publicity, "PRIVATE"),
      //     ),
      //   with: {
      //     voters: {
      //       where: (voters, { and, eq, isNull }) =>
      //         and(
      //           isNull(voters.deleted_at),
      //           eq(voters.email, ctx.session.user.email ?? ""),
      //         ),
      //     },
      //     commissioners: {
      //       where: (commissioners, { isNull }) =>
      //         isNull(commissioners.deleted_at),
      //       with: {
      //         user: true,
      //       },
      //     },
      //   },
      // });

      // TODO: not sure if this is the correct way
      const { data: election } = await ctx.supabase
        .from("elections")
        .select("*, voters(*), commissioners(*, user:users(*))")
        .eq("id", input.election_id)
        .is("deleted_at", null)
        .neq("publicity", "PRIVATE")
        .eq("voters:email", ctx.session.user.email ?? "")
        .is("voters:deleted_at", null)
        .is("commissioners:deleted_at", null)
        .single();

      if (!election)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Election not found",
        });

      if (election.variant_id === env.LEMONSQUEEZY_FREE_VARIANT_ID)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You cannot send a message in a free election",
        });

      if (!election.commissioners.length)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No commissioners found",
        });

      if (election.publicity === "PUBLIC" && !election.voters.length)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Unauthorized",
        });

      if (
        election.commissioners.find(
          (commissioner) => commissioner.user?.email === ctx.session.user.email,
        )
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot send a message to yourself",
        });

      // TODO: use transaction
      const { data: room, error: room_error } = await ctx.supabase
        .from("commissioners_voters_rooms")
        .insert({
          election_id: input.election_id,
          name: input.title,
        })
        .select("id")
        .single();

      if (room_error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: room_error.message,
        });

      await ctx.supabase.from("commissioners_voters_messages").insert({
        message: input.message,
        room_id: room.id,
        user_id: ctx.session.user.id,
      });
    }),
  getAllMyMessages: protectedProcedure
    .input(
      z.object({
        election_id: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { data: election } = await ctx.supabase
        .from("elections")
        .select()
        .eq("id", input.election_id)
        .is("deleted_at", null)
        .neq("publicity", "PRIVATE")
        .single();

      if (!election)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Election not found",
        });

      // const rooms = await ctx.db.query.commissioners_voters_rooms.findMany({
      //   where: (rooms, { eq, and, isNull }) =>
      //     and(eq(rooms.election_id, election.id), isNull(rooms.deleted_at)),
      //   orderBy: (rooms, { desc }) => desc(rooms.created_at),
      //   with: {
      //     messages: {
      //       orderBy: (messages, { desc }) => desc(messages.created_at),
      //       with: {
      //         user: true,
      //       },
      //       limit: 1,
      //     },
      //   },
      // });

      // TODO: not sure if this is the correct way
      const { data: rooms } = await ctx.supabase
        .from("commissioners_voters_rooms")
        .select("*, messages: commissioners_voters_messages(*, user:users(*))")
        .eq("election_id", election.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .order("commissioners_voters_messages:created_at", {
          ascending: false,
        });

      if (!rooms) throw new TRPCError({ code: "NOT_FOUND" });

      return rooms;
    }),
  messageAdmin: protectedProcedure
    .input(
      z.object({
        election_slug: z.string().min(1),
        title: z.string().min(1),
        message: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data: election } = await ctx.supabase
        .from("elections")
        .select("*, commissioners(*, user:users(*))")
        .eq("slug", input.election_slug)
        .is("deleted_at", null)
        .is("commissioners.deleted_at", null)
        .single();

      if (!election)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Election not found",
        });

      if (!election.commissioners.length)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No commissioners found",
        });

      // TODO: use transaction
      const { data: room, error: room_error } = await ctx.supabase
        .from("admin_commissioners_rooms")
        .insert({
          election_id: election.id,
          name: input.title,
        })
        .select("id")
        .single();

      if (room_error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: room_error.message,
        });

      await ctx.supabase.from("admin_commissioners_messages").insert({
        message: input.message,
        room_id: room.id,
        user_id: ctx.session.user.id,
      });
    }),
  getAllCommissionerVoterRooms: protectedProcedure
    .input(
      z.object({
        election_slug: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { data: election } = await ctx.supabase
        .from("elections")
        .select("*, commissioners(*, user:users(*))")
        .eq("slug", input.election_slug)
        .is("deleted_at", null)
        .is("commissioners.deleted_at", null)
        .single();

      if (!election)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Election not found",
        });

      if (
        !election.commissioners.find(
          (commissioner) => commissioner.user?.email === ctx.session.user.email,
        )
      )
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Unauthorized",
        });

      const { data: rooms } = await ctx.supabase
        .from("commissioners_voters_rooms")
        .select("*, messages: commissioners_voters_messages(*, user:users(*))")
        .eq("election_id", election.id)
        .is("deleted_at", null)
        .order("created_at", {
          referencedTable: "commissioners_voters_messages",
          ascending: false,
        })
        .limit(1, { referencedTable: "commissioners_voters_messages" })
        .order("created_at", { ascending: false });

      if (!rooms) throw new TRPCError({ code: "NOT_FOUND" });

      return rooms;
    }),
  getAllAdminCommissionerRooms: protectedProcedure
    .input(
      z.object({
        election_slug: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      // const election = await ctx.db.query.elections.findFirst({
      //   where: (elections, { eq, and, isNull }) =>
      //     and(
      //       eq(elections.slug, input.election_slug),
      //       isNull(elections.deleted_at),
      //     ),
      //   with: {
      //     commissioners: {
      //       where: (commissioners, { isNull }) =>
      //         isNull(commissioners.deleted_at),
      //       with: {
      //         user: true,
      //       },
      //     },
      //   },
      // });

      // TODO: not sure if this is the correct way
      const { data: election } = await ctx.supabase
        .from("elections")
        .select("*, commissioners(*, user:users(*))")
        .eq("slug", input.election_slug)
        .is("deleted_at", null)
        .is("commissioners.deleted_at", null)
        .single();

      if (!election)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Election not found",
        });

      if (
        !election.commissioners.find(
          (commissioner) => commissioner.user?.email === ctx.session.user.email,
        )
      )
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Unauthorized",
        });

      const { data: rooms, error: rooms_error } = await ctx.supabase
        .from("admin_commissioners_rooms")
        .select("*, messages: admin_commissioners_messages(*, user: users(*))")
        .eq("election_id", election.id)
        .is("deleted_at", null)
        .order("created_at", {
          referencedTable: "admin_commissioners_messages",
          ascending: false,
        })
        .order("created_at", { ascending: false });

      if (rooms_error)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: rooms_error.message,
        });

      if (!rooms) throw new TRPCError({ code: "NOT_FOUND" });

      return rooms;
    }),
  getMessagesAsVoter: protectedProcedure
    .input(
      z.object({
        room_id: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      // const commissionerVoterRoom =
      //   await ctx.db.query.commissioners_voters_rooms.findFirst({
      //     where: (rooms, { eq, and, isNull }) =>
      //       and(eq(rooms.id, input.room_id), isNull(rooms.deleted_at)),
      //     with: {
      //       messages: {
      //         orderBy: (messages, { asc }) => asc(messages.created_at),
      //         with: {
      //           user: true,
      //         },
      //       },
      //     },
      //   });

      // TODO: not sure if this is the correct way
      const { data: commissionerVoterRoom } = await ctx.supabase
        .from("commissioners_voters_rooms")
        .select("*, messages:commissioners_voters_messages(*, user:users(*))")
        .eq("id", input.room_id)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .single();

      if (!commissionerVoterRoom)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Room not found",
        });

      return commissionerVoterRoom.messages.map((message) => ({
        ...message,
        user: {
          ...message.user,
          isMe: message.user?.id === ctx.session.user.id,
        },
      }));
    }),
  getMessagesAsComissioner: protectedProcedure
    .input(
      z.object({
        type: z.enum(["admin", "voters"]),
        room_id: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.type === "voters") {
        const { data: commissionerVoterRoom } = await ctx.supabase
          .from("commissioners_voters_rooms")
          .select("*, messages:commissioners_voters_messages(*, user:users(*))")
          .eq("id", input.room_id)
          .is("deleted_at", null)
          .order("created_at", {
            ascending: true,
            referencedTable: "commissioners_voters_messages",
          })
          .order("created_at", { ascending: true })
          .single();

        if (!commissionerVoterRoom)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Room not found",
          });

        return commissionerVoterRoom.messages.map((message) => ({
          ...message,
          user: {
            ...message.user,
            isMe: message.user?.id === ctx.session.user.id,
          },
        }));
      } else {
        const { data: adminCommissionerRoom } = await ctx.supabase
          .from("admin_commissioners_rooms")
          .select("*, messages:admin_commissioners_messages(*, user:users(*))")
          .eq("id", input.room_id)
          .is("deleted_at", null)
          .order("created_at", {
            ascending: true,
            referencedTable: "admin_commissioners_messages",
          })
          .order("created_at", { ascending: true })
          .single();

        if (!adminCommissionerRoom)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Room not found",
          });

        return adminCommissionerRoom.messages.map((message) => ({
          ...message,
          user: {
            ...message.user,
            isMe: message.user?.id === ctx.session.user.id,
          },
        }));
      }
    }),
  sendMessageAsVoter: protectedProcedure
    .input(
      z.object({
        room_id: z.string().min(1),
        message: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data: commissionerVoterRoom } = await ctx.supabase
        .from("commissioners_voters_rooms")
        .select()
        .eq("id", input.room_id)
        .is("deleted_at", null)
        .single();

      if (!commissionerVoterRoom)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Room not found",
        });

      await ctx.supabase.from("commissioners_voters_messages").insert({
        message: input.message,
        room_id: commissionerVoterRoom.id,
        user_id: ctx.session.user.id,
      });
    }),
  sendMessageAsCommissioner: protectedProcedure
    .input(
      z.object({
        type: z.enum(["admin", "voters"]),
        room_id: z.string().min(1),
        message: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.type === "voters") {
        const { data: commissionerVoterRoom } = await ctx.supabase
          .from("commissioners_voters_rooms")
          .select()
          .eq("id", input.room_id)
          .is("deleted_at", null)
          .single();

        if (!commissionerVoterRoom)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Room not found",
          });

        await ctx.supabase.from("commissioners_voters_messages").insert({
          message: input.message,
          room_id: commissionerVoterRoom.id,
          user_id: ctx.session.user.id,
        });
      } else {
        const { data: adminCommissionerRoom } = await ctx.supabase
          .from("admin_commissioners_rooms")
          .select()
          .eq("id", input.room_id)
          .is("deleted_at", null)
          .single();

        if (!adminCommissionerRoom)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Room not found",
          });

        await ctx.supabase.from("admin_commissioners_messages").insert({
          message: input.message,
          room_id: adminCommissionerRoom.id,
          user_id: ctx.session.user.id,
        });
      }
    }),
  getElectionsPlusLeft: protectedProcedure.query(async ({ ctx }) => {
    const { data: elections_plus } = await ctx.supabase
      .from("elections_plus")
      .select()
      .eq("user_id", ctx.session.user.id)
      .is("redeemed_at", null);

    if (!elections_plus) throw new TRPCError({ code: "NOT_FOUND" });

    return elections_plus.length;
  }),
});
