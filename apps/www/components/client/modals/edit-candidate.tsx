"use client";

import { api } from "@/trpc/client";
import type { Candidate, Partylist, Position } from "@eboto-mo/db/schema";
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";
// import { YearPickerInput } from "@mantine/dates";
import type { FileWithPath } from "@mantine/dropzone";
// import { Dropzone, IMAGE_MIME_TYPE } from "@mantine/dropzone";
import { hasLength, useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import {
  IconExternalLink,
  IconFlag,
  IconInfoCircle,
  IconLetterCase,
  IconPhoto,
  IconPlus,
  IconUserSearch,
} from "@tabler/icons-react";
import Link from "next/link";
import { useParams } from "next/navigation";

export default function EditCandidate({
  candidate,
  positions,
  partylists,
}: {
  candidate: Candidate & {
    credential: {
      id: string;
      affiliations: {
        id: string;
        org_name: string;
        org_position: string;
        start_year: Date;
        end_year: Date;
      }[];
      achievements: {
        id: string;
        name: string;
        year: Date;
      }[];
      events_attended: {
        id: string;
        name: string;
        year: Date;
      }[];
    } | null;
    platforms: {
      id: string;
      title: string;
      description: string;
    }[];
  };
  positions: Position[];
  partylists: Partylist[];
}) {
  const [opened, { open, close }] = useDisclosure(false);
  // const openRef = useRef<() => void>(null);
  const params = useParams();

  // const { mutate, isLoading, isError, error, reset } =
  //   api.election.editCandidate.useMutation({
  //     onSuccess: () => {
  //       notifications.show({
  //         title: `${form.values.first_name}${
  //           form.values.middle_name && ` ${form.values.middle_name}`
  //         } ${form.values.last_name} created!`,
  //         message: `Successfully updated candidate: ${form.values.first_name}${
  //           form.values.middle_name && ` ${form.values.middle_name}`
  //         } ${form.values.last_name}`,
  //         icon: <IconCheck size="1.1rem" />,
  //         autoClose: 5000,
  //       });
  //       close();
  //     },
  //   });

  const form = useForm<{
    first_name: string;
    middle_name: string | null;
    last_name: string;
    slug: string;
    partylist_id: string;
    position: string;
    image: FileWithPath | null | string;

    platforms: {
      id: string;
      title: string;
      description: string;
    }[];

    achievements: {
      id: string;
      name: string;
      year: Date;
    }[];
    affiliations: {
      id: string;
      org_name: string;
      org_position: string;
      start_year: Date;
      end_year: Date;
    }[];
    events_attended: {
      id: string;
      name: string;
      year: Date;
    }[];
  }>({
    initialValues: {
      first_name: candidate.first_name,
      middle_name: candidate.middle_name,
      last_name: candidate.last_name,
      slug: candidate.slug,
      partylist_id: candidate.partylist_id,
      position: candidate.position_id,
      image: candidate.image_link,

      platforms: candidate.platforms ?? [],

      achievements: candidate.credential?.achievements ?? [],
      affiliations: candidate.credential?.affiliations ?? [],
      events_attended: candidate.credential?.events_attended ?? [],
    },
    validateInputOnBlur: true,
    validate: {
      first_name: hasLength(
        { min: 1 },
        "First name must be at least 1 characters",
      ),
      last_name: hasLength(
        { min: 1 },
        "Last name must be at least 1 characters",
      ),
      slug: (value) => {
        if (!value) {
          return "Please enter an election slug";
        }
        if (!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(value)) {
          return "Election slug must be alphanumeric and can contain dashes";
        }
        if (value.length < 3 || value.length > 24) {
          return "Election slug must be between 3 and 24 characters";
        }
      },
    },
  });

  const DeleteCredentialButton = ({
    type,
    id,
  }: {
    type: "PLATFORM" | "ACHIEVEMENT" | "AFFILIATION" | "EVENTATTENDED";
    id: string;
  }) => {
    // const deleteCredentialMutation =
    //   api.candidate.deleteSingleCredential.useMutation();
    // const deletePlatformMutation =
    //   api.candidate.deleteSinglePlatform.useMutation();
    return (
      <Button
        variant="outline"
        mt="xs"
        size="sm"
        w="100%"
        color="red"
        onClick={() => {
          if (type === "PLATFORM") {
            if (candidate.platforms.find((a) => a.id === id)) {
              // await deletePlatformMutation.mutateAsync({ id });
              // await context.candidate.getAll.invalidate();
              close();
            } else {
              form.setValues({
                ...form.values,
                platforms: form.values.platforms.filter((a) => a.id !== id),
              });
            }
          } else if (type === "ACHIEVEMENT") {
            if (candidate.credential?.achievements.find((a) => a.id === id)) {
              // await deleteCredentialMutation.mutateAsync({ id, type });
              // await context.candidate.getAll.invalidate();
              close();
            } else {
              form.setValues({
                ...form.values,
                achievements: form.values.achievements.filter(
                  (a) => a.id !== id,
                ),
              });
            }
          } else if (type === "AFFILIATION") {
            if (candidate.credential?.affiliations.find((a) => a.id === id)) {
              // await deleteCredentialMutation.mutateAsync({ id, type });
              // await context.candidate.getAll.invalidate();
              close();
            } else {
              form.setValues({
                ...form.values,
                affiliations: form.values.affiliations.filter(
                  (a) => a.id !== id,
                ),
              });
            }
          } else {
            if (
              candidate.credential?.events_attended.find((a) => a.id === id)
            ) {
              // await deleteCredentialMutation.mutateAsync({ id, type });
              // await context.candidate.getAll.invalidate();
              close();
            } else {
              form.setValues({
                ...form.values,
                events_attended: form.values.events_attended.filter(
                  (a) => a.id !== id,
                ),
              });
            }
          }
        }}
        // loading={
        //   deleteCredentialMutation.isLoading || deletePlatformMutation.isLoading
        // }
      >
        Delete{" "}
        {type === "PLATFORM"
          ? "Platform"
          : type === "ACHIEVEMENT"
          ? "Achievement"
          : type === "AFFILIATION"
          ? "Affiliation"
          : "Event Attended"}
      </Button>
    );
  };

  return (
    <>
      <Button onClick={open} variant="light" size="compact-sm" w="fit-content">
        Edit
      </Button>
      <Modal
        opened={
          opened
          // || isLoading
        }
        onClose={close}
        title={
          <Text fw={600} lineClamp={1}>
            Edit Candidate - {candidate.first_name} {candidate.last_name}
          </Text>
        }
        closeOnClickOutside={false}
      >
        <form
          onSubmit={form.onSubmit((values) => {
            void (async () => {
              await api.election.editCandidate.mutate({
                id: candidate.id,
                first_name: values.first_name,
                middle_name: values.middle_name,
                last_name: values.last_name,
                slug: values.slug,
                partylist_id: values.partylist_id,
                election_id: candidate.election_id,
                position_id: values.position,
                image_link: "",

                //   image: !value.image
                //     ? null
                //     : typeof value.image === "string"
                //     ? value.image
                //     : await uploadImage({
                //         path: `elections/${candidate.electionId}/candidates/${
                //           candidate.id
                //         }/image/${Date.now().toString()}`,
                //         image: value.image,
                //       }),

                // platforms: value.platforms,

                // achievements: value.achievements.map((a) => ({
                //   id: a.id,
                //   name: a.name,
                //   year: new Date(a.year?.toDateString() ?? ""),
                // })),

                // affiliations: value.affiliations.map((a) => ({
                //   id: a.id,
                //   org_name: a.org_name,
                //   org_position: a.org_position,
                //   start_year: new Date(a.start_year?.toDateString() ?? ""),
                //   end_year: new Date(a.end_year?.toDateString() ?? ""),
                // })),
                // eventsAttended: value.events_attended.map((a) => ({
                //   id: a.id,
                //   name: a.name,
                //   year: new Date(a.year?.toDateString() ?? ""),
                // })),
              });
            })();
          })}
        >
          <Tabs radius="xs" defaultValue="basic-info">
            <Tabs.List grow>
              <Tabs.Tab
                value="basic-info"
                leftSection={<IconUserSearch size="0.8rem" />}
                px="2rem"
              >
                Basic Info
              </Tabs.Tab>
              <Tabs.Tab
                value="image"
                leftSection={<IconPhoto size="0.8rem" />}
                px="2rem"
              >
                Image
              </Tabs.Tab>
              <Tabs.Tab
                value="platforms"
                leftSection={<IconInfoCircle size="0.8rem" />}
                px="2rem"
              >
                Platforms
              </Tabs.Tab>
              <Tabs.Tab
                value="credentials"
                leftSection={<IconInfoCircle size="0.8rem" />}
                px="2rem"
              >
                Credentials
              </Tabs.Tab>
            </Tabs.List>

            <Stack gap="sm">
              <Tabs.Panel value="basic-info" pt="xs">
                <Stack gap="xs">
                  <TextInput
                    label="First name"
                    placeholder="Enter first name"
                    required
                    withAsterisk
                    {...form.getInputProps("first_name")}
                    leftSection={<IconLetterCase size="1rem" />}
                  />

                  <TextInput
                    label="Middle name"
                    placeholder="Enter middle name"
                    {...form.getInputProps("middle_name")}
                    leftSection={<IconLetterCase size="1rem" />}
                  />
                  <TextInput
                    label="Last name"
                    placeholder="Enter last name"
                    required
                    withAsterisk
                    {...form.getInputProps("last_name")}
                    leftSection={<IconLetterCase size="1rem" />}
                  />

                  <TextInput
                    label="Slug"
                    placeholder="Enter slug"
                    description={
                      <Text>
                        This will be used as the candidate&apos;s URL.
                        <br />
                        eboto-mo.com/{params?.electionSlug?.toString()}/
                        {form.values.slug || "candidate-slug"}
                      </Text>
                    }
                    required
                    withAsterisk
                    {...form.getInputProps("slug")}
                    leftSection={<IconLetterCase size="1rem" />}
                  />

                  <Select
                    // withinPortal
                    placeholder="Select partylist"
                    label="Partylist"
                    leftSection={<IconFlag size="1rem" />}
                    {...form.getInputProps("partylist_id")}
                    data={partylists.map((partylist) => {
                      return {
                        label: partylist.name,
                        value: partylist.id,
                      };
                    })}
                  />

                  <Select
                    // withinPortal
                    placeholder="Select position"
                    label="Position"
                    leftSection={<IconUserSearch size="1rem" />}
                    {...form.getInputProps("position")}
                    data={positions.map((position) => {
                      return {
                        label: position.name,
                        value: position.id,
                      };
                    })}
                  />
                </Stack>
              </Tabs.Panel>

              <Tabs.Panel value="image" pt="xs">
                <Stack gap="xs">
                  {/* <Dropzone
                    id="image"
                    onDrop={(files) => {
                      if (!files[0]) return;
                      form.setFieldValue("image", files[0]);
                    }}
                    openRef={openRef}
                    maxSize={5 * 1024 ** 2}
                    accept={IMAGE_MIME_TYPE}
                    multiple={false}
                    // loading={isLoading}
                    // disabled={isLoading}
                  >
                    <Group
                      justify="center"
                      gap="xl"
                      style={{ minHeight: rem(140), pointerEvents: "none" }}
                    >
                      {form.values.image ? (
                        typeof form.values.image !== "string" &&
                        form.values.image ? (
                          <Group justify="center">
                            <Box
                              pos="relative"
                              style={() => ({
                                width: rem(120),
                                height: rem(120),

                                // [theme.fn.smallerThan("sm")]: {
                                //   width: rem(180),
                                //   height: rem(180),
                                // },
                              })}
                            >
                              <Image
                                src={
                                  typeof form.values.image === "string"
                                    ? form.values.image
                                    : URL.createObjectURL(form.values.image)
                                }
                                alt="image"
                                fill
                                sizes="100%"
                                priority
                                style={{ objectFit: "cover" }}
                              />
                            </Box>
                            <Text>{form.values.image.name}</Text>
                          </Group>
                        ) : (
                          candidate.image_link && (
                            <Group>
                              <Box
                                pos="relative"
                                style={() => ({
                                  width: rem(120),
                                  height: rem(120),

                                  // [theme.fn.smallerThan("sm")]: {
                                  //   width: rem(180),
                                  //   height: rem(180),
                                  // },
                                })}
                              >
                                <Image
                                  src={candidate.image_link}
                                  alt="image"
                                  fill
                                  sizes="100%"
                                  priority
                                  style={{ objectFit: "cover" }}
                                />
                              </Box>
                              <Text>Current image</Text>
                            </Group>
                          )
                        )
                      ) : (
                        <Box>
                          <Text size="xl" inline ta="center">
                            Drag image here or click to select image
                          </Text>
                          <Text
                            size="sm"
                            color="dimmed"
                            inline
                            mt={7}
                            ta="center"
                          >
                            Attach a image to your account. Max file size is
                            5MB.
                          </Text>
                        </Box>
                      )}
                      <Dropzone.Reject>
                        <IconX size="3.2rem" stroke={1.5} />
                      </Dropzone.Reject>
                    </Group>
                  </Dropzone> */}
                  <Group gap="sm">
                    <Button
                      onClick={() => {
                        form.setValues({
                          ...form.values,
                          image: candidate.image_link,
                        });
                      }}
                      disabled={
                        !candidate.image_link ||
                        typeof form.values.image === "string"
                        // ||
                        // isLoading
                      }
                      style={{ flex: 1 }}
                    >
                      Reset image
                    </Button>
                    <Button
                      onClick={() => {
                        form.setFieldValue("image", null);
                      }}
                      disabled={
                        !form.values.image
                        // || isLoading
                      }
                      style={{ flex: 1 }}
                    >
                      Delete image
                    </Button>
                  </Group>
                </Stack>
              </Tabs.Panel>

              <Tabs.Panel value="platforms" pt="xs">
                <Stack gap="xs">
                  {form.values.platforms.map((platform, index) => (
                    <Box key={index}>
                      <TextInput
                        w="100%"
                        label="Title"
                        placeholder="Enter title"
                        required
                        value={platform.title}
                        onChange={(e) => {
                          form.setValues({
                            ...form.values,
                            platforms: form.values.platforms.map((p, i) => {
                              if (i === index) {
                                return {
                                  ...p,
                                  title: e.target.value,
                                };
                              }
                              return p;
                            }),
                          });
                        }}
                      />
                      {/* <Textarea
                        w="100%"
                        label="Description"
                        placeholder="Enter description"
                        required
                        value={platform.description}
                        onChange={(e) => {
                          form.setValues({
                            ...form.values,
                            platforms: form.values.platforms.map((p, i) => {
                              if (i === index) {
                                return {
                                  ...p,
                                  description: e.target.value,
                                };
                              }
                              return p;
                            }),
                          });
                        }}
                      /> */}

                      <DeleteCredentialButton
                        type="PLATFORM"
                        id={platform.id}
                      />
                    </Box>
                  ))}
                  <Button
                    leftSection={<IconPlus size="1.25rem" />}
                    onClick={() => {
                      form.setValues({
                        ...form.values,

                        platforms: [
                          ...form.values.platforms,
                          {
                            id: (form.values.platforms.length + 1).toString(),
                            title: "",
                            description: "",
                          },
                        ],
                      });
                    }}
                  >
                    Add platform
                  </Button>
                </Stack>
              </Tabs.Panel>

              <Tabs.Panel value="credentials" pt="xs">
                <Tabs variant="outline" radius="xs" defaultValue="achievements">
                  <Tabs.List grow>
                    <Tabs.Tab value="achievements">
                      <Text size="xs" truncate>
                        Achievement
                      </Text>
                    </Tabs.Tab>
                    <Tabs.Tab value="affiliations">
                      <Text size="xs" truncate>
                        Affiliations
                      </Text>
                    </Tabs.Tab>
                    <Tabs.Tab value="events-attended">
                      <Text size="xs" truncate>
                        Seminars Attended
                      </Text>
                    </Tabs.Tab>
                  </Tabs.List>

                  <Tabs.Panel value="achievements" pt="xs">
                    <Stack gap="md">
                      {form.values.achievements.map((achievement, index) => {
                        return (
                          <Box key={index}>
                            <Group gap="xs">
                              <TextInput
                                w="100%"
                                label="Achievement"
                                placeholder="Enter achievement"
                                required
                                value={achievement.name}
                                onChange={(e) => {
                                  form.setValues({
                                    ...form.values,
                                    achievements: form.values.achievements.map(
                                      (achievement, i) =>
                                        i === index
                                          ? {
                                              ...achievement,
                                              name: e.target.value,
                                            }
                                          : achievement,
                                    ),
                                  });
                                }}
                              />
                              {/* <YearPickerInput
                                // label="Year"
                                placeholder="Enter year"
                                popoverProps={{
                                  withinPortal: true,
                                }}
                                value={achievement.year}
                                onChange={(date) => {
                                  form.setValues({
                                    ...form.values,
                                    achievements: form.values.achievements.map(
                                      (achievement, i) =>
                                        i === index
                                          ? {
                                              ...achievement,
                                              year: new Date(
                                                date?.toString() ?? "",
                                              ),
                                            }
                                          : achievement,
                                    ),
                                  });
                                }}
                                // required
                              /> */}
                            </Group>
                            <DeleteCredentialButton
                              type="ACHIEVEMENT"
                              id={achievement.id}
                            />
                          </Box>
                        );
                      })}

                      <Button
                        leftSection={<IconPlus size="1.25rem" />}
                        onClick={() => {
                          form.setValues({
                            ...form.values,

                            achievements: [
                              ...form.values.achievements,
                              {
                                id: (
                                  form.values.achievements.length + 1
                                ).toString(),
                                name: "",
                                year: new Date(new Date().getFullYear(), 0),
                              },
                            ],
                          });
                        }}
                      >
                        Add achievement
                      </Button>
                    </Stack>
                  </Tabs.Panel>
                  <Tabs.Panel value="affiliations" pt="xs">
                    <Stack gap="md">
                      {form.values.affiliations.map((affiliation, index) => {
                        return (
                          <Box key={index}>
                            <TextInput
                              w="100%"
                              label="Organization name"
                              placeholder="Enter organization name"
                              required
                              value={affiliation.org_name}
                              onChange={(e) => {
                                form.setValues({
                                  ...form.values,
                                  affiliations: form.values.affiliations.map(
                                    (affiliation, i) =>
                                      i === index
                                        ? {
                                            ...affiliation,
                                            org_name: e.target.value,
                                          }
                                        : affiliation,
                                  ),
                                });
                              }}
                            />
                            <TextInput
                              w="100%"
                              label="Position"
                              placeholder="Enter your position in the organization"
                              required
                              value={affiliation.org_position}
                              onChange={(e) => {
                                form.setValues({
                                  ...form.values,
                                  affiliations: form.values.affiliations.map(
                                    (affiliation, i) =>
                                      i === index
                                        ? {
                                            ...affiliation,
                                            org_position: e.target.value,
                                          }
                                        : affiliation,
                                  ),
                                });
                              }}
                            />

                            <Group gap="xs">
                              {/* <YearPickerInput
                                // label="Start year"
                                placeholder="Enter start year"
                                style={{ width: "100%" }}
                                popoverProps={{
                                  withinPortal: true,
                                }}
                                value={
                                  form.values.affiliations[index]?.start_year ??
                                  new Date()
                                }
                                onChange={(date) => {
                                  form.setValues({
                                    ...form.values,
                                    affiliations: form.values.affiliations.map(
                                      (affiliation, i) =>
                                        i === index
                                          ? {
                                              ...affiliation,
                                              start_year: new Date(
                                                date?.toString() ?? "",
                                              ),
                                            }
                                          : affiliation,
                                    ),
                                  });
                                }}
                                // required
                              /> */}
                              {/* <YearPickerInput
                                // label="End year"
                                placeholder="Enter end year"
                                style={{ width: "100%" }}
                                popoverProps={{
                                  withinPortal: true,
                                }}
                                value={
                                  form.values.affiliations[index]?.end_year ??
                                  new Date()
                                }
                                onChange={(date) => {
                                  form.setValues({
                                    ...form.values,
                                    affiliations: form.values.affiliations.map(
                                      (affiliation, i) =>
                                        i === index
                                          ? {
                                              ...affiliation,
                                              end_year: new Date(
                                                date?.toString() ?? "",
                                              ),
                                            }
                                          : affiliation,
                                    ),
                                  });
                                }}
                                // required
                              /> */}
                            </Group>
                            <DeleteCredentialButton
                              type="AFFILIATION"
                              id={affiliation.id}
                            />
                          </Box>
                        );
                      })}

                      <Button
                        leftSection={<IconPlus size="1.25rem" />}
                        onClick={() => {
                          form.setValues({
                            ...form.values,

                            affiliations: [
                              ...form.values.affiliations,
                              {
                                id: (
                                  form.values.affiliations.length + 1
                                ).toString(),
                                org_name: "",
                                org_position: "",
                                start_year: new Date(
                                  new Date().getFullYear(),
                                  -1,
                                ),
                                end_year: new Date(new Date().getFullYear(), 0),
                              },
                            ],
                          });
                        }}
                      >
                        Add affiliation
                      </Button>
                    </Stack>
                  </Tabs.Panel>
                  <Tabs.Panel value="events-attended" pt="xs">
                    <Stack gap="md">
                      {form.values.events_attended.map(
                        (events_attended, index) => {
                          return (
                            <Box key={index}>
                              <Group gap="xs">
                                <TextInput
                                  w="100%"
                                  label="Seminars attended"
                                  placeholder="Enter seminars attended"
                                  required
                                  value={
                                    form.values.events_attended[index]?.name ??
                                    ""
                                  }
                                  onChange={(e) => {
                                    form.setValues({
                                      ...form.values,
                                      events_attended:
                                        form.values.events_attended.map(
                                          (achievement, i) =>
                                            i === index
                                              ? {
                                                  ...achievement,
                                                  name: e.target.value,
                                                }
                                              : achievement,
                                        ),
                                    });
                                  }}
                                />
                                {/* <YearPickerInput
                                  // label="Year"
                                  placeholder="Enter year"
                                  popoverProps={{
                                    withinPortal: true,
                                  }}
                                  value={
                                    form.values.events_attended[index]?.year ??
                                    new Date()
                                  }
                                  onChange={(date) => {
                                    form.setValues({
                                      ...form.values,
                                      events_attended:
                                        form.values.events_attended.map(
                                          (achievement, i) =>
                                            i === index
                                              ? {
                                                  ...achievement,
                                                  year: new Date(
                                                    date?.toString() ?? "",
                                                  ),
                                                }
                                              : achievement,
                                        ),
                                    });
                                  }}
                                  // required
                                /> */}
                              </Group>
                              <DeleteCredentialButton
                                type="EVENTATTENDED"
                                id={events_attended.id}
                              />
                            </Box>
                          );
                        },
                      )}

                      <Button
                        leftSection={<IconPlus size="1.25rem" />}
                        onClick={() => {
                          form.setValues({
                            ...form.values,

                            events_attended: [
                              ...form.values.events_attended,
                              {
                                id: (
                                  form.values.events_attended.length + 1
                                ).toString(),
                                name: "",
                                year: new Date(new Date().getFullYear(), 0),
                              },
                            ],
                          });
                        }}
                      >
                        Add seminar attended
                      </Button>
                    </Stack>
                  </Tabs.Panel>
                </Tabs>
              </Tabs.Panel>

              {/* {isError && (
                <Alert
                  icon={<IconAlertCircle size="1rem" />}
                  title="Error"
                  color="red"
                >
                  {error.message}
                </Alert>
              )} */}

              <Group justify="space-around" gap={0}>
                <ActionIcon
                  size="lg"
                  variant="outline"
                  color="green"
                  visibleFrom="sm"
                >
                  <IconExternalLink size="1.25rem" />
                </ActionIcon>
                <Button
                  hiddenFrom="sm"
                  leftSection={<IconExternalLink size="1.25rem" />}
                  variant="outline"
                  component={Link}
                  href={`/${params?.electionSlug as string}/${candidate.slug}`}
                  target="_blank"
                >
                  Visit
                </Button>

                <Group justify="right" gap="xs">
                  <Button
                    variant="default"
                    onClick={close}
                    // disabled={isLoading}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={!form.isDirty()}
                    // loading={isLoading}
                  >
                    Update
                  </Button>
                </Group>
              </Group>
            </Stack>
          </Tabs>
        </form>
      </Modal>
    </>
  );
}
